import { PromptManager, LLMTaskMode, type OutputMode } from '../llm';
import type {
  CoverImagePromptContext,
  EditAssistantManuscriptPromptContext,
  EditAssistantStoryObjectPromptContext,
  ObjectImagePromptContext,
  SceneImagePromptContext,
  StoryTranslationPromptContext,
} from '../llm/types';
import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import type { ObjectType } from '../types/unifiedObject';
import type { JourneySpec, EditingTargets } from './types';

// =====================================================================
// Input Types
// =====================================================================

export type AiEditCategory = ObjectType | 'manuscript';

export interface AiEditInput {
  projectId: string;
  category: AiEditCategory;
  targetId?: string;
  userRequest: string;
  selectedContextIds: string[];
  rawMode?: boolean;
}

export interface TranslateObjectsInput {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  userInput?: string;
  objectIds: string[];
  contextObjectIds?: string[];
  rawMode?: boolean;
}

export type PromptMode = 'natural' | 'positive' | 'negative';
export type ContextType = 'object' | 'cover_image' | 'scene';

export interface ImagePromptInput {
  projectId: string;
  promptMode: PromptMode;
  contextType: ContextType;
  userRequest: string;
  objectType?: 'character' | 'location' | 'organization' | 'lorebook';
  objectId?: string;
  basicInfoId?: string;
  sceneContext?: { preContext: string; postContext: string };
  selectedObjectIds?: string[];
}

export interface ImagePromptResult {
  prompt: string;
  mode: PromptMode;
}

// =====================================================================
// Helpers
// =====================================================================

const CATEGORY_LABELS: Record<string, string> = {
  basic_info: 'Basic Info',
  character: 'Character',
  organization: 'Organization',
  location: 'Location',
  lorebook: 'Lorebook',
  outline: 'Outline',
  act: 'Act',
  chapter: 'Chapter',
  manuscript: 'Manuscript',
};

function computeOutputMode(rawMode?: boolean): OutputMode {
  const settingsStore = useSettingsStore.getState();
  if (rawMode) return 'raw_output';
  return settingsStore.settings.nativeOutputMode ? 'native_function_call' : 'tool_call';
}

function getObjectLabel(obj: any, language: string): { name: string; description: string } {
  const data = obj?.data?.[language] || (obj?.data ? Object.values(obj.data)[0] : {}) || {};
  return {
    name: (data as any).name || (data as any).title || '',
    description: (data as any).description || (data as any).logline || '',
  };
}

function buildCurrentTranslatedContents(params: {
  objectIds: string[];
  targetLanguage: string;
}): Array<{ id: string; type: string; name: string; translatedContent: string }> {
  const { objectIds, targetLanguage } = params;
  const store = useUnifiedObjectStore.getState();

  const results: Array<{ id: string; type: string; name: string; translatedContent: string }> = [];

  for (const id of objectIds) {
    const obj = store.getObject(id);
    if (!obj) continue;
    const data = obj.data[targetLanguage];
    if (!data) continue;

    if (obj.type === 'basic_info') {
      const title = (data as any).title ?? '';
      const logline = (data as any).logline ?? '';
      const genre = (data as any).genre ?? '';
      results.push({
        id,
        type: obj.type,
        name: title,
        translatedContent: `title: ${title}\nlogline: ${logline}\ngenre: ${genre}`,
      });
      continue;
    }

    if (obj.type === 'manuscript') {
      const content = (data as any).content ?? '';
      results.push({
        id,
        type: obj.type,
        name: id,
        translatedContent: content,
      });
      continue;
    }

    const name = (data as any).name ?? '';
    const description = (data as any).description ?? '';
    results.push({
      id,
      type: obj.type,
      name,
      translatedContent: `name: ${name}\ndescription: ${description}`,
    });
  }

  return results;
}

// =====================================================================
// aiEdit Spec
// =====================================================================

const aiEditSpec: JourneySpec<AiEditInput> = {
  kind: 'aiEdit',

  label: (input) => {
    const categoryLabel = CATEGORY_LABELS[input.category] ?? input.category;
    if (!input.targetId) {
      return `AI Edit: ${categoryLabel}`;
    }

    const store = useUnifiedObjectStore.getState();
    const mainLanguage = useSettingsStore.getState().settings.mainLanguage;

    if (input.category === 'manuscript') {
      const chapter = store.getObject(input.targetId);
      const langData = chapter?.data?.[mainLanguage] || (chapter?.data ? Object.values(chapter.data)[0] : undefined);
      const chapterName = (langData as any)?.name ?? '';
      return chapterName ? `AI Edit: ${categoryLabel} - ${chapterName}` : `AI Edit: ${categoryLabel}`;
    }

    const obj = store.getObject(input.targetId);
    const name =
      (obj?.data ? (obj.data as any)[mainLanguage] : undefined)?.name ??
      (obj?.data ? (obj.data as any)[mainLanguage] : undefined)?.title ??
      (obj?.data ? (Object.values(obj.data)[0] as any) : undefined)?.name ??
      (obj?.data ? (Object.values(obj.data)[0] as any) : undefined)?.title ??
      '';

    return name ? `AI Edit: ${categoryLabel} - ${name}` : `AI Edit: ${categoryLabel}`;
  },

  buildEditingTargets: (input) => {
    const settingsStore = useSettingsStore.getState();
    const mainLanguage = settingsStore.settings.mainLanguage;
    const targetId = (input.targetId ?? '').trim();
    if (!targetId) {
      throw new Error('aiEdit requires targetId.');
    }
    return {
      kind: 'aiEdit',
      projectId: input.projectId,
      category: input.category,
      targetId,
      selectedContextIds: input.selectedContextIds ?? [],
      language: mainLanguage,
    };
  },

  buildLLMConfig: (input, journey) => {
    const settingsStore = useSettingsStore.getState();
    const unifiedStore = useUnifiedObjectStore.getState();

    const mainLanguage = settingsStore.settings.mainLanguage;
    const outputMode = computeOutputMode(input.rawMode);
    const editAssistantConfig = settingsStore.getFunctionConfig('editAssistant');

    const isManuscriptMode = input.category === 'manuscript';
    const targetId = journey.editingTargets.kind === 'aiEdit' ? journey.editingTargets.targetId : (input.targetId ?? '');

    const contextIds = (input.selectedContextIds ?? []).filter((id) => {
      if (!id) return false;
      if (isManuscriptMode) {
        const manuscriptObj = unifiedStore.getManuscriptByChapterId(targetId);
        return manuscriptObj ? id !== manuscriptObj.id : true;
      }
      return id !== targetId;
    });

    if (isManuscriptMode) {
      const manuscriptObj = unifiedStore.getManuscriptByChapterId(targetId);
      if (!manuscriptObj) {
        throw new Error(`Manuscript not found for chapter ${targetId}`);
      }

      const chapter = unifiedStore.getObject(targetId);
      const chapterData = chapter?.data?.[mainLanguage] || (chapter?.data ? Object.values(chapter.data)[0] : undefined);
      const chapterName = (chapterData as any)?.name ?? '';

      const manuscriptData = manuscriptObj.data[mainLanguage] || Object.values(manuscriptObj.data)[0] || {};
      const currentContent = (manuscriptData as any)?.content ?? '';

      const promptContext: EditAssistantManuscriptPromptContext = {
        projectId: input.projectId,
        currentId: manuscriptObj.id,
        currentChapterId: targetId,
        currentChapterName: chapterName,
        currentChapterContent: currentContent,
        objectIds: contextIds.length > 0 ? contextIds : undefined,
        outputMode,
        outputLanguage: mainLanguage,
        enablePrefill: editAssistantConfig.advanced.enablePrefill,
        enableThinking: editAssistantConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: editAssistantConfig.advanced.thinkingMode === 'custom',
      };

      return {
        mode: LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT,
        projectId: input.projectId,
        promptContext,
        prepared: {
          messages: [],
          functions: PromptManager.getFunctionsForMode(LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT, promptContext),
          outputMode,
        },
        thinkingMode: editAssistantConfig.advanced.thinkingMode,
        thinkingConfig: editAssistantConfig.advanced.thinkingConfig,
      };
    }

    const promptContext: EditAssistantStoryObjectPromptContext = {
      projectId: input.projectId,
      targetIds: [targetId],
      contextIds: contextIds.length > 0 ? contextIds : undefined,
      outputMode,
      outputLanguage: mainLanguage,
      enablePrefill: editAssistantConfig.advanced.enablePrefill,
      enableThinking: editAssistantConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: editAssistantConfig.advanced.thinkingMode === 'custom',
    };

    return {
      mode: LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT,
      projectId: input.projectId,
      promptContext,
      prepared: {
        messages: [],
        functions: PromptManager.getFunctionsForMode(LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT, promptContext),
        outputMode,
      },
      thinkingMode: editAssistantConfig.advanced.thinkingMode,
      thinkingConfig: editAssistantConfig.advanced.thinkingConfig,
    };
  },

  handleRawOutput: async (input, journey, text) => {
    const unifiedStore = useUnifiedObjectStore.getState();
    const targets = journey.editingTargets;
    if (targets.kind !== 'aiEdit') throw new Error('Invalid journey editingTargets for aiEdit.');

    if (targets.category === 'manuscript') {
      const manuscriptObj = unifiedStore.getManuscriptByChapterId(targets.targetId);
      if (!manuscriptObj) {
        throw new Error(`Manuscript not found for chapter ${targets.targetId}`);
      }
      const currentData = manuscriptObj.data[targets.language] || {};
      await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
        language: targets.language,
        data: { ...currentData, content: text },
        user_request: input.userRequest ?? '',
      });
      return;
    }

    const obj = unifiedStore.getObject(targets.targetId);
    if (!obj) {
      throw new Error(`Object not found: ${targets.targetId}`);
    }
    const currentData = obj.data[targets.language] || {};
    await unifiedStore.updateObject(obj.type, targets.targetId, {
      language: targets.language,
      data: { ...currentData, description: text },
      user_request: input.userRequest ?? '',
    });
  },
};

// =====================================================================
// translateObjects Spec
// =====================================================================

const translateObjectsSpec: JourneySpec<TranslateObjectsInput> = {
  kind: 'translateObjects',

  label: () => 'Translation',

  buildEditingTargets: (input) => ({
    kind: 'translateObjects',
    projectId: input.projectId,
    objectIds: input.objectIds,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    contextObjectIds: input.contextObjectIds,
  }),

  buildLLMConfig: (input) => {
    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('translation');

    const outputMode = computeOutputMode(input.rawMode);

    const promptContext: StoryTranslationPromptContext = {
      projectId: input.projectId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      objectCount: input.objectIds.length,
      objectsArray: input.objectIds.map((id) => ({ objectId: id })),
      contextObjectIds: input.contextObjectIds,
      currentTranslatedContents: buildCurrentTranslatedContents({
        objectIds: input.objectIds,
        targetLanguage: input.targetLanguage,
      }),
      outputMode,
      outputLanguage: input.targetLanguage,
      enablePrefill: translationConfig.advanced.enablePrefill,
      enableThinking: translationConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: translationConfig.advanced.thinkingMode === 'custom',
    };

    return {
      mode: LLMTaskMode.TRANSLATION,
      projectId: input.projectId,
      promptContext,
      prepared: {
        messages: [],
        functions: PromptManager.getFunctionsForMode(LLMTaskMode.TRANSLATION, promptContext),
        outputMode,
      },
      thinkingMode: translationConfig.advanced.thinkingMode,
      thinkingConfig: translationConfig.advanced.thinkingConfig,
    };
  },

  handleRawOutput: async (_input, journey, text) => {
    const unifiedStore = useUnifiedObjectStore.getState();
    const targets = journey.editingTargets;
    if (targets.kind !== 'translateObjects') {
      throw new Error('Invalid journey editingTargets for translateObjects.');
    }

    if (targets.objectIds.length !== 1) {
      throw new Error('Raw output translation requires exactly one objectId.');
    }

    const targetId = targets.objectIds[0];
    const obj = unifiedStore.getObject(targetId);
    if (!obj) {
      throw new Error(`Object not found: ${targetId}`);
    }

    const lang = targets.targetLanguage;
    const currentData = obj.data[lang] || {};

    if (obj.type === 'manuscript') {
      await unifiedStore.updateObject('manuscript', targetId, {
        language: lang,
        data: { ...currentData, content: text },
        create_new_version: false,
      });
    } else {
      await unifiedStore.updateObject(obj.type, targetId, {
        language: lang,
        data: { ...currentData, description: text },
        create_new_version: false,
      });
    }
  },
};

// =====================================================================
// imagePrompt Spec
// =====================================================================

const imagePromptSpec: JourneySpec<ImagePromptInput, ImagePromptResult> = {
  kind: 'imagePrompt',

  label: (input) => (input.contextType === 'cover_image' ? 'Cover Image Prompt' : 'Image Prompt'),

  buildEditingTargets: (input) =>
    ({
      kind: input.contextType === 'scene' ? 'sceneImage' : 'imagePrompt',
      projectId: input.projectId,
      contextType: input.contextType as any,
      promptMode: input.promptMode,
      objectType: input.objectType,
      objectId: input.objectId,
      basicInfoId: input.basicInfoId,
      sceneContext: input.sceneContext,
      selectedObjectIds: input.selectedObjectIds,
    }) as EditingTargets,

  buildLLMConfig: (input) => {
    const settingsStore = useSettingsStore.getState();
    const unifiedStore = useUnifiedObjectStore.getState();

    const imagePromptConfig = settingsStore.getFunctionConfig('imagePrompt');
    const mainLanguage = settingsStore.settings.mainLanguage;

    const outputMode: OutputMode = 'raw_output';

    if (input.contextType === 'cover_image') {
      const basicInfoObj = Object.values(unifiedStore.objects).find((o) => o.type === 'basic_info');
      if (!basicInfoObj) {
        throw new Error('Basic info not found.');
      }

      const data = basicInfoObj.data[mainLanguage] || Object.values(basicInfoObj.data)[0] || {};
      const promptContext: CoverImagePromptContext = {
        projectId: input.projectId,
        promptMode: input.promptMode,
        basicInfo: {
          title: (data as any).title || '',
          logline: (data as any).logline || '',
          genre: (data as any).genre || '',
        },
        selectedObjects: [],
        outputMode,
        outputLanguage: mainLanguage,
        enablePrefill: imagePromptConfig.advanced.enablePrefill,
        enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
      };

      return {
        mode: LLMTaskMode.COVER_IMAGE_PROMPT,
        projectId: input.projectId,
        promptContext,
        thinkingMode: imagePromptConfig.advanced.thinkingMode,
        thinkingConfig: imagePromptConfig.advanced.thinkingConfig,
      };
    }

    if (input.contextType === 'scene') {
      const selectedObjects = (input.selectedObjectIds ?? [])
        .map((id) => unifiedStore.objects[id])
        .filter(Boolean)
        .map((obj: any) => {
          const data = getObjectLabel(obj, mainLanguage);
          return {
            id: obj.id,
            type: obj.type,
            name: data.name,
            description: data.description,
            imagePrompt: obj.metadata?.image_prompt,
          };
        });

      const promptContext: SceneImagePromptContext = {
        projectId: input.projectId,
        promptMode: input.promptMode,
        scenePreContext: input.sceneContext?.preContext || '',
        scenePostContext: input.sceneContext?.postContext || '',
        selectedObjects,
        outputMode,
        outputLanguage: mainLanguage,
        enablePrefill: imagePromptConfig.advanced.enablePrefill,
        enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
      };

      return {
        mode: LLMTaskMode.SCENE_IMAGE_PROMPT,
        projectId: input.projectId,
        promptContext,
        thinkingMode: imagePromptConfig.advanced.thinkingMode,
        thinkingConfig: imagePromptConfig.advanced.thinkingConfig,
      };
    }

    // object context
    if (!input.objectId || !input.objectType) {
      throw new Error('Missing object context.');
    }

    const obj = unifiedStore.objects[input.objectId];
    if (!obj) {
      throw new Error('Object not found.');
    }

    const data = getObjectLabel(obj, mainLanguage);
    const savedPrompts = {
      natural: obj.metadata?.image_prompt || null,
      positive: obj.metadata?.image_prompt_positive || null,
      negative: obj.metadata?.image_prompt_negative || null,
    };

    const promptContext: ObjectImagePromptContext = {
      projectId: input.projectId,
      promptMode: input.promptMode,
      objectType: input.objectType,
      objectInfo: `${data.name}\n\n${data.description}`.trim(),
      currentPrompt: savedPrompts.natural,
      currentPromptPositive: savedPrompts.positive,
      currentPromptNegative: savedPrompts.negative,
      outputMode,
      outputLanguage: mainLanguage,
      enablePrefill: imagePromptConfig.advanced.enablePrefill,
      enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
    };

    return {
      mode: LLMTaskMode.OBJECT_IMAGE_PROMPT,
      projectId: input.projectId,
      promptContext,
      thinkingMode: imagePromptConfig.advanced.thinkingMode,
      thinkingConfig: imagePromptConfig.advanced.thinkingConfig,
    };
  },

  handleRawOutput: async (input, _journey, text) => {
    return { prompt: text, mode: input.promptMode };
  },
};

// =====================================================================
// sceneImage Spec (uses same config as imagePrompt)
// =====================================================================

const sceneImageSpec: JourneySpec<ImagePromptInput, ImagePromptResult> = {
  kind: 'sceneImage',
  label: () => 'Scene Image Prompt',
  buildEditingTargets: imagePromptSpec.buildEditingTargets,
  buildLLMConfig: imagePromptSpec.buildLLMConfig,
  handleRawOutput: imagePromptSpec.handleRawOutput,
};

// =====================================================================
// Registry
// =====================================================================

export const journeySpecs = {
  aiEdit: aiEditSpec,
  translateObjects: translateObjectsSpec,
  imagePrompt: imagePromptSpec,
  sceneImage: sceneImageSpec,
} as const;

export type JourneyKind = keyof typeof journeySpecs;

export function getJourneySpec<K extends JourneyKind>(kind: K): (typeof journeySpecs)[K] {
  const spec = journeySpecs[kind];
  if (!spec) {
    throw new Error(`Unknown journey kind: ${kind}`);
  }
  return spec;
}

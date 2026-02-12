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
import { docWordCount, normalizeDoc } from '../editor/manuscript/doc';
import { docToMarkdown, markdownToDoc } from '../editor/manuscript/convert';

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
  return settingsStore.getSettings().nativeOutputMode ? 'native_tool_call' : 'tool_call';
}

function getObjectTextFields(obj: any, language: string): { name: string; description: string; content: string } {
  const data = obj?.data?.[language] || (obj?.data ? Object.values(obj.data)[0] : {}) || {};
  return {
    name: (data as any).name || (data as any).title || '',
    description: (data as any).description || (data as any).logline || '',
    content: (data as any).content || '',
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

    if (obj.type === 'guidelines') {
      const authorNote = (data as any).authorNote ?? '';
      results.push({
        id,
        type: obj.type,
        name: 'Guidelines',
        translatedContent: authorNote,
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
    const mainLanguage = useSettingsStore.getState().getSettings().mainLanguage;

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
    const mainLanguage = settingsStore.getSettings().mainLanguage;
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

    const mainLanguage = settingsStore.getSettings().mainLanguage;
    const outputMode = computeOutputMode(input.rawMode);
    const editAssistantConfig = settingsStore.getTaskConfig('editAssistant');

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
      const currentDoc = normalizeDoc((manuscriptData as any)?.doc);
      const currentContent = docToMarkdown(currentDoc);

      const promptContext: EditAssistantManuscriptPromptContext = {
        projectId: input.projectId,
        currentId: manuscriptObj.id,
        currentChapterId: targetId,
        currentChapterName: chapterName,
        currentChapterContent: currentContent,
        objectIds: contextIds.length > 0 ? contextIds : undefined,
        outputMode,
        outputLanguage: mainLanguage,
        enable_prefill: editAssistantConfig.advanced.enable_prefill,
        thinking_mode: editAssistantConfig.advanced.thinking_mode,
      };

      return {
        mode: LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT,
        projectId: input.projectId,
        promptContext,
        prepared: {
          messages: [],
          tools: PromptManager.getToolsForMode(LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT, promptContext),
          outputMode,
        },
        thinking_mode: editAssistantConfig.advanced.thinking_mode,
        thinking_config: editAssistantConfig.advanced.thinking_config,
      };
    }

    const promptContext: EditAssistantStoryObjectPromptContext = {
      projectId: input.projectId,
      targetIds: [targetId],
      contextIds: contextIds.length > 0 ? contextIds : undefined,
      outputMode,
      outputLanguage: mainLanguage,
      enable_prefill: editAssistantConfig.advanced.enable_prefill,
      thinking_mode: editAssistantConfig.advanced.thinking_mode,
    };

    return {
      mode: LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT,
      projectId: input.projectId,
      promptContext,
      prepared: {
        messages: [],
        tools: PromptManager.getToolsForMode(LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT, promptContext),
        outputMode,
      },
      thinking_mode: editAssistantConfig.advanced.thinking_mode,
      thinking_config: editAssistantConfig.advanced.thinking_config,
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

      const nextDoc = markdownToDoc(text ?? '');
      const wordCount = docWordCount(nextDoc);
      await unifiedStore.updateObject('manuscript', manuscriptObj.id, {
        language: targets.language,
        data: { doc: nextDoc, wordCount },
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
      data: { ...currentData, content: text ?? '' },
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
    const translationConfig = settingsStore.getTaskConfig('translation');

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
      enable_prefill: translationConfig.advanced.enable_prefill,
      thinking_mode: translationConfig.advanced.thinking_mode,
    };

    return {
      mode: LLMTaskMode.TRANSLATION,
      projectId: input.projectId,
      promptContext,
      prepared: {
        messages: [],
        tools: PromptManager.getToolsForMode(LLMTaskMode.TRANSLATION, promptContext),
        outputMode,
      },
      thinking_mode: translationConfig.advanced.thinking_mode,
      thinking_config: translationConfig.advanced.thinking_config,
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
      const nextDoc = markdownToDoc(text ?? '');
      const wordCount = docWordCount(nextDoc);
      await unifiedStore.updateObject('manuscript', targetId, {
        language: lang,
        data: { doc: nextDoc, wordCount },
        create_new_version: false,
      });
    } else {
      await unifiedStore.updateObject(obj.type, targetId, {
        language: lang,
        data: { ...currentData, content: text ?? '' },
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

    const imagePromptConfig = settingsStore.getTaskConfig('imagePrompt');
    const mainLanguage = settingsStore.getSettings().mainLanguage;

    const outputMode: OutputMode = 'raw_output';

    if (input.contextType === 'cover_image') {
      const basicInfoObj = Object.values(unifiedStore.objects).find((o) => o.type === 'basic_info');
      if (!basicInfoObj) {
        throw new Error('Basic info not found.');
      }

      const data = basicInfoObj.data[mainLanguage] || Object.values(basicInfoObj.data)[0] || {};
      const title = (data as any).title || '';
      const logline = (data as any).logline || '';
      const genre = (data as any).genre || '';
      const promptContext: CoverImagePromptContext = {
        projectId: input.projectId,
        promptMode: input.promptMode,
        basicInfo: {
          title,
          logline,
          genre,
        },
        selectedObjects: [],
        currentObject: {
          type: 'basic_info',
          name: title,
          description: logline,
          content: '',
          image_prompt: basicInfoObj.metadata?.image_prompt ?? null,
          image_prompt_positive: basicInfoObj.metadata?.image_prompt_positive ?? null,
          image_prompt_negative: basicInfoObj.metadata?.image_prompt_negative ?? null,
        },
        outputMode,
        outputLanguage: mainLanguage,
        enable_prefill: imagePromptConfig.advanced.enable_prefill,
        thinking_mode: imagePromptConfig.advanced.thinking_mode,
      };

      return {
        mode: LLMTaskMode.COVER_IMAGE_PROMPT,
        projectId: input.projectId,
        promptContext,
        thinking_mode: imagePromptConfig.advanced.thinking_mode,
        thinking_config: imagePromptConfig.advanced.thinking_config,
      };
    }

    if (input.contextType === 'scene') {
      const selectedObjects = (input.selectedObjectIds ?? [])
        .map((id) => unifiedStore.objects[id])
        .filter(Boolean)
        .map((obj: any) => {
          const data = getObjectTextFields(obj, mainLanguage);
          return {
            id: obj.id,
            type: obj.type,
            name: data.name,
            description: data.description,
            content: data.content,
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
        enable_prefill: imagePromptConfig.advanced.enable_prefill,
        thinking_mode: imagePromptConfig.advanced.thinking_mode,
      };

      return {
        mode: LLMTaskMode.SCENE_IMAGE_PROMPT,
        projectId: input.projectId,
        promptContext,
        thinking_mode: imagePromptConfig.advanced.thinking_mode,
        thinking_config: imagePromptConfig.advanced.thinking_config,
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

    const data = getObjectTextFields(obj, mainLanguage);

    const promptContext: ObjectImagePromptContext = {
      projectId: input.projectId,
      promptMode: input.promptMode,
      currentObject: {
        type: input.objectType,
        name: data.name,
        description: data.description,
        content: data.content,
        image_prompt: obj.metadata?.image_prompt ?? null,
        image_prompt_positive: obj.metadata?.image_prompt_positive ?? null,
        image_prompt_negative: obj.metadata?.image_prompt_negative ?? null,
      },
      outputMode,
      outputLanguage: mainLanguage,
      enable_prefill: imagePromptConfig.advanced.enable_prefill,
      thinking_mode: imagePromptConfig.advanced.thinking_mode,
    };

    return {
      mode: LLMTaskMode.OBJECT_IMAGE_PROMPT,
      projectId: input.projectId,
      promptContext,
      thinking_mode: imagePromptConfig.advanced.thinking_mode,
      thinking_config: imagePromptConfig.advanced.thinking_config,
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

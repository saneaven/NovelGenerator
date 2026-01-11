import { PromptManager, LLMTaskMode, type LLMTaskModeType, type OutputMode } from '../llm';
import type {
  CoverImagePromptContext,
  EditAssistantManuscriptPromptContext,
  EditAssistantStoryObjectPromptContext,
  ObjectImagePromptContext,
  PromptContext,
  SceneImagePromptContext,
  StoryTranslationPromptContext,
} from '../llm/types';
import type { FunctionCallSchema } from '../functionCall';
import { useSettingsStore } from '../store/settingsStore';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import type { AiEditTaskInput } from '../llmTask/specs/aiEditSpec';
import type { TranslateObjectsTaskInput } from '../llmTask/specs/translateObjectsSpec';
import type { ImagePromptTaskInput } from '../llmTask/specs/imagePromptSpec';
import type { EditingTargets, LLMTaskJourney } from './types';

export type JourneyAttemptConfig = {
  llmMode: LLMTaskModeType;
  promptContext: PromptContext;
  outputMode: OutputMode;
  projectId: string;
  templateProjectLanguage: string;
  editingObjectIds: string[];
  functions?: FunctionCallSchema[];
};

export type JourneySpec<TInput> = {
  buildEditingTargets: (input: TInput) => EditingTargets;
  buildAttemptConfig: (params: { input: TInput; journey: LLMTaskJourney }) => JourneyAttemptConfig;
};

function computeDefaultOutputMode(params: { rawMode?: boolean }): OutputMode {
  const { rawMode } = params;
  const settingsStore = useSettingsStore.getState();
  if (rawMode) return 'raw_output';
  return settingsStore.settings.nativeOutputMode ? 'native_function_call' : 'tool_call';
}

// =====================================================================
// aiEdit
// =====================================================================

const aiEditSpec: JourneySpec<AiEditTaskInput> = {
  buildEditingTargets: (input) => {
    const settingsStore = useSettingsStore.getState();
    const mainLanguage = settingsStore.settings.mainLanguage;
    const targetId = (input.targetId ?? '').trim();
    if (!targetId) {
      throw new Error('aiEdit requires targetId in journey mode.');
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

  buildAttemptConfig: ({ input, journey }) => {
    const settingsStore = useSettingsStore.getState();
    const unifiedStore = useUnifiedObjectStore.getState();

    const editAssistantConfig = settingsStore.getFunctionConfig('editAssistant');
    const mainLanguage = settingsStore.settings.mainLanguage;
    const outputMode = computeDefaultOutputMode({ rawMode: input.rawMode });

    const isManuscriptMode = input.category === 'manuscript';
    const targetId = journey.editingTargets.kind === 'aiEdit' ? journey.editingTargets.targetId : (input.targetId ?? '');

    const contextIds = (input.selectedContextIds ?? []).filter((id) => {
      if (!id) return false;
      if (isManuscriptMode) {
        // Manuscript targetId is chapterId; exclude manuscript object itself from context.
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
        userInput: input.userRequest.trim(),
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
        llmMode: LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT,
        promptContext,
        outputMode,
        projectId: input.projectId,
        templateProjectLanguage: mainLanguage,
        editingObjectIds: [manuscriptObj.id],
        functions: PromptManager.getFunctionsForMode(LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT, promptContext),
      };
    }

    const promptContext: EditAssistantStoryObjectPromptContext = {
      userInput: input.userRequest.trim(),
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
      llmMode: LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT,
      promptContext,
      outputMode,
      projectId: input.projectId,
      templateProjectLanguage: mainLanguage,
      editingObjectIds: [targetId],
      functions: PromptManager.getFunctionsForMode(LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT, promptContext),
    };
  },
};

// =====================================================================
// translateObjects
// =====================================================================

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

  return results.length > 0 ? results : [];
}

const translateObjectsSpec: JourneySpec<TranslateObjectsTaskInput> = {
  buildEditingTargets: (input) => ({
    kind: 'translateObjects',
    projectId: input.projectId,
    objectIds: input.objectIds,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    contextObjectIds: input.contextObjectIds,
  }),

  buildAttemptConfig: ({ input }) => {
    const settingsStore = useSettingsStore.getState();
    const translationConfig = settingsStore.getFunctionConfig('translation');

    const outputMode = computeDefaultOutputMode({ rawMode: input.rawMode });

    const promptContext: StoryTranslationPromptContext = {
      userInput: input.userInput?.trim() || '',
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
      llmMode: LLMTaskMode.TRANSLATION,
      promptContext,
      outputMode,
      projectId: input.projectId,
      templateProjectLanguage: input.sourceLanguage,
      editingObjectIds: input.objectIds,
      functions: PromptManager.getFunctionsForMode(LLMTaskMode.TRANSLATION, promptContext),
    };
  },
};

// =====================================================================
// imagePrompt / sceneImage
// =====================================================================

function getObjectLabel(obj: any, language: string): { name: string; description: string } {
  const data = obj?.data?.[language] || (obj?.data ? Object.values(obj.data)[0] : {}) || {};
  return {
    name: (data as any).name || (data as any).title || '',
    description: (data as any).description || (data as any).logline || '',
  };
}

const imagePromptSpec: JourneySpec<ImagePromptTaskInput> = {
  buildEditingTargets: (input) => ({
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

  buildAttemptConfig: ({ input }) => {
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
        userInput: input.userRequest,
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

      const editingObjectIds = input.basicInfoId ? [input.basicInfoId] : [basicInfoObj.id];

      return {
        llmMode: LLMTaskMode.COVER_IMAGE_PROMPT,
        promptContext,
        outputMode,
        projectId: input.projectId,
        templateProjectLanguage: mainLanguage,
        editingObjectIds,
        functions: undefined,
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
        userInput: input.userRequest,
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
        llmMode: LLMTaskMode.SCENE_IMAGE_PROMPT,
        promptContext,
        outputMode,
        projectId: input.projectId,
        templateProjectLanguage: mainLanguage,
        editingObjectIds: input.selectedObjectIds ?? [],
        functions: undefined,
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
      userInput: input.userRequest,
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
      llmMode: LLMTaskMode.OBJECT_IMAGE_PROMPT,
      promptContext,
      outputMode,
      projectId: input.projectId,
      templateProjectLanguage: mainLanguage,
      editingObjectIds: [input.objectId],
      functions: undefined,
    };
  },
};

export const journeySpecs = {
  aiEdit: aiEditSpec,
  translateObjects: translateObjectsSpec,
  imagePrompt: imagePromptSpec,
  sceneImage: imagePromptSpec,
} as const;


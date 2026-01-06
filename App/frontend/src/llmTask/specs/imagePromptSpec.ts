import type { TaskSpec } from './types';
import { useSettingsStore } from '../../store/settingsStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { LLMTask, LLMTaskMode, type LLMTaskModeType, type ObjectImagePromptContext, type SceneImagePromptContext, type CoverImagePromptContext, type SelectedObjectContext } from '../../llm';
import type { LLMTaskResult } from '../../llm/types';

export type PromptMode = 'natural' | 'positive' | 'negative';
export type ContextType = 'object' | 'cover_image' | 'scene';

export interface ImagePromptTaskInput {
  projectId: string;
  promptMode: PromptMode;
  contextType: ContextType;
  userRequest: string;

  // object context
  objectType?: 'character' | 'location' | 'organization' | 'lorebook';
  objectId?: string;

  // cover_image context
  basicInfoId?: string;

  // scene context
  sceneContext?: { preContext: string; postContext: string };
  selectedObjectIds?: string[];
}

export interface ImagePromptTaskResult {
  prompt: string;
  mode: PromptMode;
}

function getObjectLabel(obj: any, language: string): { name: string; description: string } {
  const data = obj?.data?.[language] || (obj?.data ? Object.values(obj.data)[0] : {}) || {};
  return {
    name: (data as any).name || (data as any).title || '',
    description: (data as any).description || (data as any).logline || '',
  };
}

async function runImagePromptTask(params: {
  input: ImagePromptTaskInput;
  abortController: AbortController;
  updateSession: (partial: any) => void;
}): Promise<ImagePromptTaskResult | void> {
  const { input, abortController, updateSession } = params;
  const settingsStore = useSettingsStore.getState();
  const unifiedStore = useUnifiedObjectStore.getState();

  const imagePromptConfig = settingsStore.getFunctionConfig('imagePrompt');
  const providerConfig = settingsStore.getProviderConfig(imagePromptConfig.provider);

  const mainLanguage = settingsStore.settings.mainLanguage;
  const nativeOutputMode = settingsStore.settings.nativeOutputMode;

  let llmMode: LLMTaskModeType = LLMTaskMode.OBJECT_IMAGE_PROMPT;
  let promptContext: ObjectImagePromptContext | SceneImagePromptContext | CoverImagePromptContext;
  let forceNativeOutput = false;

  if (input.contextType === 'cover_image') {
    forceNativeOutput = true;
    llmMode = LLMTaskMode.COVER_IMAGE_PROMPT;

    const basicInfoObj = Object.values(unifiedStore.objects).find(o => o.type === 'basic_info');
    if (!basicInfoObj) {
      updateSession({ status: 'error', error: 'Basic info not found.' });
      return;
    }

    const data = basicInfoObj.data[mainLanguage] || Object.values(basicInfoObj.data)[0] || {};
    promptContext = {
      userInput: input.userRequest,
      projectId: input.projectId,
      promptMode: input.promptMode,
      basicInfo: {
        title: (data as any).title || '',
        logline: (data as any).logline || '',
        genre: (data as any).genre || '',
      },
      selectedObjects: [],
      isNativeOutput: true,
      outputLanguage: mainLanguage,
      enablePrefill: imagePromptConfig.advanced.enablePrefill,
      enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
    };
  } else if (input.contextType === 'scene') {
    forceNativeOutput = true;
    llmMode = LLMTaskMode.SCENE_IMAGE_PROMPT;

    const selectedObjects: SelectedObjectContext[] = (input.selectedObjectIds ?? [])
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

    promptContext = {
      userInput: input.userRequest,
      projectId: input.projectId,
      promptMode: input.promptMode,
      scenePreContext: input.sceneContext?.preContext || '',
      scenePostContext: input.sceneContext?.postContext || '',
      selectedObjects,
      isNativeOutput: true,
      outputLanguage: mainLanguage,
      enablePrefill: imagePromptConfig.advanced.enablePrefill,
      enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
    };
  } else {
    // object context
    if (!input.objectId || !input.objectType) {
      updateSession({ status: 'error', error: 'Missing object context.' });
      return;
    }

    llmMode = LLMTaskMode.OBJECT_IMAGE_PROMPT;

    const obj = unifiedStore.objects[input.objectId];
    if (!obj) {
      updateSession({ status: 'error', error: 'Object not found.' });
      return;
    }

    const data = getObjectLabel(obj, mainLanguage);
    const savedPrompts = {
      natural: obj.metadata?.image_prompt || null,
      positive: obj.metadata?.image_prompt_positive || null,
      negative: obj.metadata?.image_prompt_negative || null,
    };

    const isNativeOutput = nativeOutputMode;
    promptContext = {
      userInput: input.userRequest,
      projectId: input.projectId,
      promptMode: input.promptMode,
      objectType: input.objectType,
      objectInfo: `${data.name}\n\n${data.description}`.trim(),
      currentPrompt: savedPrompts.natural,
      currentPromptPositive: savedPrompts.positive,
      currentPromptNegative: savedPrompts.negative,
      isNativeOutput,
      outputLanguage: mainLanguage,
      enablePrefill: imagePromptConfig.advanced.enablePrefill,
      enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
    };
  }

  let result: LLMTaskResult | null = null;
  const task = new LLMTask(
    {
      mode: llmMode,
      projectId: input.projectId,
      promptContext,
      abortController,
      provider: imagePromptConfig.provider,
      providerConfig,
      model: imagePromptConfig.model,
      temperature: imagePromptConfig.temperature,
      thinkingMode: imagePromptConfig.advanced.thinkingMode as any,
      thinkingConfig: imagePromptConfig.advanced.thinkingConfig,
      retryConfig: settingsStore.settings.retryConfig,
    },
    {
      onUpdate: (parts) => updateSession({ contentParts: parts }),
      onFunctionProgress: (progress) => updateSession({ functionCallProgress: progress }),
      onComplete: (r) => {
        result = r;
      },
      onError: () => {
        // handled by throw
      },
    }
  );

  await task.run();

  if (!result) {
    updateSession({ status: 'error', error: 'AI request finished without a result.' });
    return;
  }

  const finalResult = result as unknown as LLMTaskResult;

  updateSession({ provider: finalResult.provider, model: finalResult.model, usage: finalResult.usage });

  const text = finalResult.contentParts
    .filter(p => p.type === 'content')
    .map(p => p.text)
    .join('')
    .trim();

  if (forceNativeOutput || nativeOutputMode) {
    if (!text) {
      updateSession({ status: 'error', error: 'AI did not generate a prompt.' });
      return;
    }
    return { prompt: text, mode: input.promptMode };
  }

  // Function-call mode (object context only)
  const call = finalResult.functionCalls.find(c => c.function_name === 'generate_object_image_prompt');
  if (call?.arguments) {
    const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
    const prompt = (args as any)?.prompt;
    if (typeof prompt === 'string' && prompt.trim()) {
      return { prompt: prompt.trim(), mode: input.promptMode };
    }
  }

  if (!text) {
    updateSession({ status: 'error', error: 'AI did not generate a prompt.' });
    return;
  }

  return { prompt: text, mode: input.promptMode };
}

export const imagePromptSpec: TaskSpec<'imagePrompt', ImagePromptTaskInput, ImagePromptTaskResult> = {
  kind: 'imagePrompt',
  label: (input) => (input.contextType === 'cover_image' ? 'Cover Image Prompt' : 'Image Prompt'),
  run: async ({ input, abortController, updateSession }) => {
    return await runImagePromptTask({ input, abortController, updateSession });
  },
};

export const sceneImageSpec: TaskSpec<'sceneImage', ImagePromptTaskInput, ImagePromptTaskResult> = {
  kind: 'sceneImage',
  label: () => 'Scene Image Prompt',
  run: async ({ input, abortController, updateSession }) => {
    return await runImagePromptTask({ input, abortController, updateSession });
  },
};

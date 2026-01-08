import type { TaskSpec } from './types';
import { useSettingsStore } from '../../store/settingsStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { LLMTask, LLMTaskMode, type StoryTranslationPromptContext, type OutputMode } from '../../llm';
import type { LLMTaskResult } from '../../llm/types';
import { stageSessionEdits } from '../functionCalls/functionCallEngine';

export interface TranslateObjectsTaskInput {
  projectId: string;
  sourceLanguage: string;
  targetLanguage: string;
  userInput?: string;
  objectIds: string[];
  contextObjectIds?: string[];
  rawMode?: boolean;
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

  return results.length > 0 ? results : [];
}

export const translateObjectsSpec: TaskSpec<'translateObjects', TranslateObjectsTaskInput, void> = {
  kind: 'translateObjects',
  label: () => 'Translation',
  run: async ({ sessionId, input, abortController, updateSession }) => {
    const settingsStore = useSettingsStore.getState();
    const unifiedStore = useUnifiedObjectStore.getState();

    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);

    // Determine output mode: rawMode from input takes priority
    // Note: The modal only shows rawMode toggle when it's valid (single object, not basic_info)
    const outputMode: OutputMode = input.rawMode
      ? 'raw_output'
      : (settingsStore.settings.nativeOutputMode ? 'native_function_call' : 'tool_call');

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

    let result: LLMTaskResult | null = null;

    const task = new LLMTask(
      {
        mode: LLMTaskMode.TRANSLATION,
        projectId: input.projectId,
        promptContext,
        abortController,
        provider: translationConfig.provider,
        providerConfig,
        model: translationConfig.model,
        temperature: translationConfig.temperature,
        thinkingMode: translationConfig.advanced.thinkingMode as any,
        thinkingConfig: translationConfig.advanced.thinkingConfig,
        retryConfig: settingsStore.settings.retryConfig,
      },
      {
        onUpdate: (parts) => updateSession({ contentParts: parts }),
        onFunctionProgress: (progress) => updateSession({ functionCallProgress: progress }),
        onComplete: (r) => {
          result = r;
        },
        onError: () => {
          // Error is handled by LLMTask.run() throwing
        },
      }
    );

    await task.run();

    if (!result) {
      updateSession({ status: 'error', error: 'Translation request finished without a result.' });
      return;
    }

    const finalResult = result as unknown as LLMTaskResult;

    updateSession({ provider: finalResult.provider, model: finalResult.model, usage: finalResult.usage });

    // Handle raw output mode - apply translation directly without function calls
    if (outputMode === 'raw_output' && input.objectIds.length === 1) {
      const rawContent = finalResult.contentParts
        .filter(p => p.type === 'content')
        .map(p => p.text)
        .join('')
        .trim();

      if (!rawContent) {
        updateSession({ status: 'error', error: 'AI response was empty.' });
        return;
      }

      const targetId = input.objectIds[0];
      const obj = unifiedStore.getObject(targetId);

      if (obj) {
        const currentData = obj.data[input.targetLanguage] || {};

        if (obj.type === 'manuscript') {
          // For manuscript: apply raw output to content field
          await unifiedStore.updateObject('manuscript', targetId, {
            language: input.targetLanguage,
            data: {
              ...currentData,
              content: rawContent,
            },
            create_new_version: false,
          });
        } else {
          // For story objects: apply raw output to description field
          await unifiedStore.updateObject(obj.type, targetId, {
            language: input.targetLanguage,
            data: {
              ...currentData,
              description: rawContent,
            },
            create_new_version: false,
          });
        }
      }

      updateSession({ status: 'success' });
      return;
    }

    const functionCalls = finalResult.functionCalls;

    if (!functionCalls.length) {
      updateSession({ status: 'error', error: 'AI response did not include any actions to apply.' });
      return;
    }

    await stageSessionEdits({
      sessionId,
      projectId: input.projectId,
      language: input.targetLanguage,
      functionCalls,
    });
  },
};

import type { TaskSpec } from './types';
import type { ContentPart } from '../../llm/requestTypes';
import { useAgentStore } from '../../store/agentStore';
import { useSettingsStore } from '../../store/settingsStore';
import { LLMTask, LLMTaskMode, type AgentTranslationPromptContext } from '../../llm';
import type { LLMTaskResult } from '../../llm/types';

export interface AgentTranslationTaskInput {
  projectId: string;
  agentId: string;
  messageId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceContent: string;
  originalContentParts: ContentPart[];
}

export interface AgentTranslationTaskResult {
  agentId: string;
  messageId: string;
  targetLanguage: string;
}

export const agentTranslationSpec: TaskSpec<'agentTranslation', AgentTranslationTaskInput, AgentTranslationTaskResult> = {
  kind: 'agentTranslation',
  label: () => 'Agent Translation',
  run: async ({ input, abortController, updateSession }) => {
    const agentStore = useAgentStore.getState();
    const settingsStore = useSettingsStore.getState();

    const translationConfig = settingsStore.getFunctionConfig('translation');
    const providerConfig = settingsStore.getProviderConfig(translationConfig.provider);

    const promptContext: AgentTranslationPromptContext = {
      userInput: '',
      projectId: input.projectId,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      sourceContent: input.sourceContent,
      isNativeOutput: true,
      outputLanguage: input.targetLanguage,
      enablePrefill: translationConfig.advanced.enablePrefill,
      enableThinking: translationConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: translationConfig.advanced.thinkingMode === 'custom',
    };

    let result: LLMTaskResult | null = null;

    const task = new LLMTask(
      {
        mode: LLMTaskMode.AGENT_TRANSLATION,
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
        onComplete: (r) => {
          result = r;
        },
        onError: () => {
          // Error handled by throw
        },
      }
    );

    await task.run();

    if (!result) {
      updateSession({ status: 'error', error: 'Translation finished without a result.' });
      return { agentId: input.agentId, messageId: input.messageId, targetLanguage: input.targetLanguage };
    }

    const finalResult = result as unknown as LLMTaskResult;

    updateSession({ provider: finalResult.provider, model: finalResult.model, usage: finalResult.usage });

    const translated = finalResult.contentParts
      .filter(p => p.type === 'content')
      .map(p => p.text)
      .join('')
      .trim();

    if (!translated) {
      updateSession({ status: 'error', error: 'AI did not generate a translation.' });
      return { agentId: input.agentId, messageId: input.messageId, targetLanguage: input.targetLanguage };
    }

    const translatedContentParts = input.originalContentParts.map((part) => {
      if (part.type === 'content') {
        return { ...part, text: translated };
      }
      return part;
    });

    await agentStore.addTranslatedMessage(
      input.projectId,
      input.agentId,
      input.messageId,
      { contentParts: translatedContentParts },
      input.targetLanguage
    );

    return { agentId: input.agentId, messageId: input.messageId, targetLanguage: input.targetLanguage };
  },
};

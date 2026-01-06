import type { TaskSpec } from './types';
import { useAgentStore } from '../../store/agentStore';
import { useSettingsStore } from '../../store/settingsStore';
import { generateTempId } from '../../utils/tempId';
import { LLMTask, LLMTaskMode, type AgentWorkspacePromptContext } from '../../llm';
import type { LLMTaskResult } from '../../llm/types';
import { getFunctionsForSet } from '../../functionCall';
import { stageSessionEdits } from '../functionCalls/functionCallEngine';

export interface AgentTaskInput {
  projectId: string;
  agentId: string;
  mode: 'novelEditor' | 'storyObject' | 'outlineManager';
  userInput: string;
  outputLanguage: string;
  contextObjectIds?: string[];
}

export interface AgentTaskResult {
  agentId: string;
  assistantMessageId: string;
}

function getMessageText(contentParts: Array<{ type: string; text: string }>): string {
  return contentParts
    .filter(p => p.type === 'content')
    .map(p => p.text)
    .join('');
}

export const agentSpec: TaskSpec<'agent', AgentTaskInput, AgentTaskResult> = {
  kind: 'agent',
  label: () => 'AI Response',
  run: async ({ sessionId, input, abortController, updateSession }) => {
    const agentStore = useAgentStore.getState();
    const settingsStore = useSettingsStore.getState();
    const settings = settingsStore.settings;
    const agentConfig = settingsStore.getFunctionConfig('agent');
    const providerConfig = settingsStore.getProviderConfig(agentConfig.provider);

    const userInput = input.userInput ?? '';
    const language = input.outputLanguage;

    // 1) Create user message (if any) and assistant placeholder
    if (userInput.trim()) {
      await agentStore.addMessage(
        input.projectId,
        input.agentId,
        {
          id: generateTempId(),
          role: 'user',
          contentParts: [{ type: 'content', text: userInput }],
          timestamp: new Date(),
        },
        language
      );
    }

    const assistantMessageId = await agentStore.addMessage(
      input.projectId,
      input.agentId,
      {
        id: generateTempId(),
        role: 'assistant',
        contentParts: [],
        timestamp: new Date(),
      },
      language
    );

    // Allow UI to associate streaming progress with the placeholder message immediately.
    updateSession({ result: { agentId: input.agentId, assistantMessageId } as any });

    // 2) Build history (exclude the empty assistant message we just added)
    const fullHistory = agentStore.getMessages(input.projectId, input.agentId, language);
    const historyWithoutAssistant = fullHistory.slice(0, -1);

    // Remove the user message we just added (it goes into promptContext.userInput)
    const baseHistory = userInput.trim() ? historyWithoutAssistant.slice(0, -1) : historyWithoutAssistant;

    // Merge trailing user messages (failed previous runs)
    let previousHistory = baseHistory;
    const trailingUserTexts: string[] = [];
    while (previousHistory.length > 0 && previousHistory[previousHistory.length - 1].role === 'user') {
      const last = previousHistory[previousHistory.length - 1];
      trailingUserTexts.unshift(getMessageText(last.contentParts));
      previousHistory = previousHistory.slice(0, -1);
    }
    const combinedUserInput = [...trailingUserTexts, userInput].filter(Boolean).join('\n\n');

    const llmMode =
      input.mode === 'storyObject'
        ? LLMTaskMode.AGENT_STORYOBJECT
        : input.mode === 'outlineManager'
          ? LLMTaskMode.AGENT_OUTLINE_MANAGER
          : LLMTaskMode.AGENT_NOVEL_EDITOR;

    const promptContext: AgentWorkspacePromptContext = {
      userInput: combinedUserInput,
      projectId: input.projectId,
      outputLanguage: language,
      enablePrefill: agentConfig.advanced.enablePrefill,
      enableThinking: agentConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: agentConfig.advanced.thinkingMode === 'custom',
      functions: getFunctionsForSet('agent'),
      contextObjectIds: input.contextObjectIds,
    };

    let result: LLMTaskResult | null = null;

    const task = new LLMTask(
      {
        mode: llmMode,
        projectId: input.projectId,
        promptContext,
        abortController,
        provider: agentConfig.provider,
        providerConfig,
        model: agentConfig.model,
        temperature: agentConfig.temperature,
        thinkingMode: agentConfig.advanced.thinkingMode as any,
        thinkingConfig: agentConfig.advanced.thinkingConfig,
        retryConfig: settings.retryConfig,
      },
      {
        onUpdate: (parts) => {
          agentStore.updateMessageContentLocal(input.projectId, input.agentId, assistantMessageId, parts, language);
          updateSession({ contentParts: parts });
        },
        onFunctionProgress: (progress) => updateSession({ functionCallProgress: progress }),
        onComplete: (r) => {
          result = r;
        },
        onError: () => {
          // Error is handled by LLMTask.run() throwing
        },
      }
    );

    await task.run(previousHistory);

    if (!result) {
      updateSession({ status: 'error', error: 'AI request finished without a result.' });
      return { agentId: input.agentId, assistantMessageId };
    }

    const finalResult = result as unknown as LLMTaskResult;

    updateSession({ provider: finalResult.provider, model: finalResult.model, usage: finalResult.usage });

    // Final update + backend sync
    agentStore.updateMessageContentLocal(
      input.projectId,
      input.agentId,
      assistantMessageId,
      finalResult.contentParts,
      language,
      finalResult.thinkingDetails
    );
    try {
      await agentStore.updateMessage(
        input.projectId,
        input.agentId,
        assistantMessageId,
        finalResult.contentParts,
        language,
        finalResult.thinkingDetails
      );
    } catch (error) {
      console.error('Failed to sync message to backend:', error);
    }

    if (finalResult.functionCalls.length > 0) {
      await stageSessionEdits({
        sessionId,
        projectId: input.projectId,
        language: settings.mainLanguage,
        functionCalls: finalResult.functionCalls,
      });
    }

    return { agentId: input.agentId, assistantMessageId };
  },
};

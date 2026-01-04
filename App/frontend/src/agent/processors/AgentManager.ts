import type { MutableRefObject } from 'react';
import type { ChatMessage, FunctionCallMetadata, ContentPart, FunctionCallProgress } from '../../llm/requestTypes';
import type { ProviderType, ProviderConfig, ThinkingConfig, RetryConfig } from '../../store/settingsStore';
import { generateTempId } from '../../utils/tempId';
import { LLMTask, LLMTaskMode, LLMTaskManager, type TaskHandle, type AgentWorkspacePromptContext, type AgentNovelEditorPromptContext, type AgentOutlineManagerPromptContext } from '../../llm';

/**
 * Find the index of the last user message in an array of chat messages
 */
export function findLastUserMessageIdx(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      return i;
    }
  }
  return -1;
}

export interface AgentManagerConfig {
  projectId: string;
  getSelectedContextIds?: () => string[];
  getIsLoading: () => boolean;
  setIsLoading: (loading: boolean) => void;
  abortControllerRef: MutableRefObject<AbortController | null>;
  getActiveAgentId: () => string | undefined;
  getConversationLanguage: () => string;
  aiModel?: string;
  temperature?: number;
  provider: ProviderType;
  providerConfig: ProviderConfig;
  functions?: any[];
  mode: 'novelEditor' | 'storyObject' | 'outlineManager';
  enablePrefill?: boolean;
  thinkingMode?: 'off' | 'model' | 'custom';
  thinkingConfig?: ThinkingConfig;
  retryConfig?: RetryConfig;
}

export interface AgentManagerCallbacks {
  onUpdateMessage: (projectId: string, agentId: string, messageId: string, contentParts: ContentPart[], language: string, thinking_details?: any[]) => void;
  onSyncMessageToBackend: (projectId: string, agentId: string, messageId: string, contentParts: ContentPart[], language: string, thinking_details?: any[]) => Promise<void>;
  /** Callback for function calls - can be async to support validation */
  onFunctionCalls: (projectId: string, agentId: string, messageId: string, functionCalls: FunctionCallMetadata[], sessionId?: string) => void | Promise<void>;
  onAddMessage: (projectId: string, agentId: string, message: ChatMessage, language: string) => Promise<string>;
  onGetAgentHistory: (projectId: string, agentId: string, language: string) => ChatMessage[];
  onError: (error: Error) => void;
  onErrorMessage?: (projectId: string, agentId: string, messageId: string, errorMessage: string, language: string) => void;
  onFunctionCallProgress?: (projectId: string, agentId: string, messageId: string, progress: FunctionCallProgress[]) => void;
}

export class AgentManager {
  private config: AgentManagerConfig;
  private callbacks: AgentManagerCallbacks;
  private task: LLMTask | null = null;
  private taskHandle: TaskHandle | null = null;
  private isAborted = false;
  private currentMessageId: string | null = null;

  constructor(config: AgentManagerConfig, callbacks: AgentManagerCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  async processUserMessage(userMessage: ChatMessage): Promise<void> {
    if (this.config.getIsLoading() || this.task) return;

    const agentId = this.config.getActiveAgentId();
    if (!agentId) return;

    const language = this.config.getConversationLanguage();
    this.config.setIsLoading(true);
    this.isAborted = false;

    // Start task with unique session ID for independent tracking
    this.taskHandle = LLMTaskManager.startTask({
      taskType: 'agent',
      label: 'AI Response',
    });

    try {
      await this.callbacks.onAddMessage(this.config.projectId, agentId, userMessage, language);
      const assistantMessageId = await this.callbacks.onAddMessage(
        this.config.projectId,
        agentId,
        this.createAssistantMessage(),
        language
      );
      this.currentMessageId = assistantMessageId;

      await this.runLLMTask(agentId, assistantMessageId, language, this.getMessageText(userMessage));

      this.taskHandle?.complete();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.cleanup();
    }
  }

  async processEmptyRequest(): Promise<void> {
    if (this.config.getIsLoading() || this.task) return;

    const agentId = this.config.getActiveAgentId();
    if (!agentId) return;

    const language = this.config.getConversationLanguage();
    this.config.setIsLoading(true);
    this.isAborted = false;

    // Start task with unique session ID for independent tracking
    this.taskHandle = LLMTaskManager.startTask({
      taskType: 'agent',
      label: 'AI Response',
    });

    try {
      const assistantMessageId = await this.callbacks.onAddMessage(
        this.config.projectId,
        agentId,
        this.createAssistantMessage(),
        language
      );
      this.currentMessageId = assistantMessageId;

      await this.runLLMTask(agentId, assistantMessageId, language, '');

      this.taskHandle?.complete();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.cleanup();
    }
  }

  abort(): void {
    this.isAborted = true;
    this.task?.abort();
  }

  private async runLLMTask(
    agentId: string,
    assistantMessageId: string,
    language: string,
    userInput: string
  ): Promise<void> {
    const agentHistory = this.callbacks.onGetAgentHistory(this.config.projectId, agentId, language);
    // Remove the empty assistant message we just added
    const history = agentHistory.slice(0, -1);
    // Remove the user message we just added (it goes into userInput)
    let previousHistory = userInput ? history.slice(0, -1) : history;

    // Handle trailing user messages (from previous failed requests without assistant response)
    // Collect and merge them with current userInput, then remove from history
    const trailingUserTexts: string[] = [];
    while (previousHistory.length > 0 && previousHistory[previousHistory.length - 1].role === 'user') {
      const lastMsg = previousHistory[previousHistory.length - 1];
      trailingUserTexts.unshift(this.getMessageText(lastMsg));
      previousHistory = previousHistory.slice(0, -1);
    }

    // Combine trailing user messages with current userInput
    const combinedUserInput = [...trailingUserTexts, userInput].filter(Boolean).join('\n\n');

    const mode = this.config.mode === 'storyObject'
      ? LLMTaskMode.AGENT_STORYOBJECT
      : this.config.mode === 'outlineManager'
      ? LLMTaskMode.AGENT_OUTLINE_MANAGER
      : LLMTaskMode.AGENT_NOVEL_EDITOR;

    const promptContext = this.buildPromptContext(combinedUserInput, language);

    let result: { contentParts: ContentPart[]; functionCalls: FunctionCallMetadata[]; thinkingDetails?: any[] } | null = null;

    this.task = new LLMTask(
      {
        mode,
        projectId: this.config.projectId,
        promptContext,
        abortControllerRef: this.config.abortControllerRef,
        sessionId: this.taskHandle?.sessionId,
        provider: this.config.provider,
        providerConfig: this.config.providerConfig,
        model: this.config.aiModel,
        temperature: this.config.temperature,
        thinkingMode: this.config.thinkingMode,
        thinkingConfig: this.config.thinkingConfig,
        retryConfig: this.config.retryConfig,
      },
      {
        onUpdate: (parts) => {
          this.callbacks.onUpdateMessage(this.config.projectId, agentId, assistantMessageId, parts, language);
        },
        onComplete: (r) => {
          result = r;
        },
        onError: (_error) => {
          // Don't rethrow - error propagates via LLMTask.run() throw
          // The catch block in processUserMessage/processEmptyRequest will call handleError()
        },
        onFunctionProgress: (progress) => {
          this.callbacks.onFunctionCallProgress?.(this.config.projectId, agentId, assistantMessageId, progress);
        },
      }
    );

    await this.task.run(previousHistory);

    if (result) {
      await this.finishProcessing(agentId, assistantMessageId, result, language);
    }
  }

  private buildPromptContext(
    userInput: string,
    language: string
  ): AgentWorkspacePromptContext | AgentNovelEditorPromptContext | AgentOutlineManagerPromptContext {
    const contextObjectIds = this.config.getSelectedContextIds?.();

    // Both modes use the same base context - mode only affects systemPrompt template selection
    return {
      userInput,
      projectId: this.config.projectId,
      outputLanguage: language,
      enablePrefill: this.config.enablePrefill,
      enableThinking: this.config.thinkingMode === 'model',
      enableCustomThinking: this.config.thinkingMode === 'custom',
      functions: this.config.functions,
      contextObjectIds,
    };
  }

  private async finishProcessing(
    agentId: string,
    messageId: string,
    result: { contentParts: ContentPart[]; functionCalls: FunctionCallMetadata[]; thinkingDetails?: any[] },
    language: string
  ): Promise<void> {
    // Final update
    this.callbacks.onUpdateMessage(
      this.config.projectId,
      agentId,
      messageId,
      result.contentParts,
      language,
      result.thinkingDetails
    );

    // Sync to backend
    try {
      await this.callbacks.onSyncMessageToBackend(
        this.config.projectId,
        agentId,
        messageId,
        result.contentParts,
        language,
        result.thinkingDetails
      );
    } catch (error) {
      console.error('Failed to sync message to backend:', error);
    }

    // Process function calls (async validation is supported)
    if (result.functionCalls.length > 0) {
      await this.callbacks.onFunctionCalls(this.config.projectId, agentId, messageId, result.functionCalls, this.taskHandle?.sessionId);
    }
  }

  private handleError(error: unknown): void {
    const isAbortError = error instanceof DOMException && error.name === 'AbortError';

    if (isAbortError || this.isAborted) {
      this.taskHandle?.cancel();
    } else {
      const err = error instanceof Error ? error : new Error(String(error));

      // Show error inline in the agent message
      const agentId = this.config.getActiveAgentId();
      if (agentId && this.currentMessageId) {
        this.callbacks.onErrorMessage?.(
          this.config.projectId,
          agentId,
          this.currentMessageId,
          err.message,
          this.config.getConversationLanguage()
        );
      }

      this.taskHandle?.error(err.message);
    }
  }

  private cleanup(): void {
    this.config.setIsLoading(false);
    this.task = null;
    this.taskHandle = null;
    this.isAborted = false;
    this.currentMessageId = null;
    this.config.abortControllerRef.current = null;
  }

  private createAssistantMessage(): ChatMessage {
    return {
      id: generateTempId(),
      role: 'assistant',
      contentParts: [],
      timestamp: new Date(),
    };
  }

  private getMessageText(msg: ChatMessage): string {
    return msg.contentParts
      .filter(p => p.type === 'content')
      .map(p => p.text)
      .join('');
  }
}

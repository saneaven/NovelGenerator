import type { MutableRefObject } from 'react';
import type { ChatMessage, FunctionCallMetadata, ContentPart, FunctionCallProgress, FunctionCallResultSummary } from '../../llm/requestTypes';
import type { ProviderType, ProviderConfig, ThinkingConfig, RetryConfig } from '../../store/settingsStore';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import { generateTempId } from '../../utils/tempId';
import { LLMTask, LLMTaskMode, type ChatWorkspacePromptContext, type ChatNovelEditorPromptContext } from '../../llm';

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

export interface ChatManagerConfig {
  projectId: string;
  getStoryObjects: () => any;
  getNovelData?: () => any;
  getPendingFunctionCallResults?: () => FunctionCallResultSummary[];
  getIsLoading: () => boolean;
  setIsLoading: (loading: boolean) => void;
  abortControllerRef: MutableRefObject<AbortController | null>;
  getActiveChatId: () => string | undefined;
  getConversationLanguage: () => string;
  aiModel?: string;
  temperature?: number;
  provider: ProviderType;
  providerConfig: ProviderConfig;
  functions?: any[];
  mode: 'novelEditor' | 'workspace';
  enablePrefill?: boolean;
  thinkingMode?: 'off' | 'model' | 'custom';
  thinkingConfig?: ThinkingConfig;
  retryConfig?: RetryConfig;
  sessionId?: string;
}

export interface ChatManagerCallbacks {
  onUpdateMessage: (projectId: string, chatId: string, messageId: string, contentParts: ContentPart[], language: string, thinking_details?: any[]) => void;
  onSyncMessageToBackend: (projectId: string, chatId: string, messageId: string, contentParts: ContentPart[], language: string, thinking_details?: any[]) => Promise<void>;
  onFunctionCalls: (projectId: string, chatId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  onAddMessage: (projectId: string, chatId: string, message: ChatMessage, language: string) => Promise<string>;
  onGetChatHistory: (projectId: string, chatId: string, language: string) => ChatMessage[];
  onError: (error: Error) => void;
  onFunctionCallProgress?: (projectId: string, chatId: string, messageId: string, progress: FunctionCallProgress[]) => void;
}

export class ChatManager {
  private config: ChatManagerConfig;
  private callbacks: ChatManagerCallbacks;
  private task: LLMTask | null = null;
  private isAborted = false;

  constructor(config: ChatManagerConfig, callbacks: ChatManagerCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  async processUserMessage(userMessage: ChatMessage): Promise<void> {
    if (this.config.getIsLoading() || this.task) return;

    const chatId = this.config.getActiveChatId();
    if (!chatId) return;

    const language = this.config.getConversationLanguage();
    this.config.setIsLoading(true);
    this.isAborted = false;

    if (this.config.sessionId) {
      useLLMTaskStore.getState().setRunning(this.config.sessionId, 'AI Response', 'chat');
    }

    try {
      await this.callbacks.onAddMessage(this.config.projectId, chatId, userMessage, language);
      const assistantMessageId = await this.callbacks.onAddMessage(
        this.config.projectId,
        chatId,
        this.createAssistantMessage(),
        language
      );

      await this.runLLMTask(chatId, assistantMessageId, language, this.getMessageText(userMessage));

      if (this.config.sessionId) {
        useLLMTaskStore.getState().setSuccess(this.config.sessionId);
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.cleanup();
    }
  }

  async processEmptyRequest(): Promise<void> {
    if (this.config.getIsLoading() || this.task) return;

    const chatId = this.config.getActiveChatId();
    if (!chatId) return;

    const language = this.config.getConversationLanguage();
    this.config.setIsLoading(true);
    this.isAborted = false;

    if (this.config.sessionId) {
      useLLMTaskStore.getState().setRunning(this.config.sessionId, 'AI Response', 'chat');
    }

    try {
      const assistantMessageId = await this.callbacks.onAddMessage(
        this.config.projectId,
        chatId,
        this.createAssistantMessage(),
        language
      );

      await this.runLLMTask(chatId, assistantMessageId, language, '');

      if (this.config.sessionId) {
        useLLMTaskStore.getState().setSuccess(this.config.sessionId);
      }
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
    chatId: string,
    assistantMessageId: string,
    language: string,
    userInput: string
  ): Promise<void> {
    const chatHistory = this.callbacks.onGetChatHistory(this.config.projectId, chatId, language);
    // Remove the empty assistant message we just added
    const history = chatHistory.slice(0, -1);
    // Remove the user message we just added (it goes into userInput)
    const previousHistory = userInput ? history.slice(0, -1) : history;

    const mode = this.config.mode === 'workspace'
      ? LLMTaskMode.CHAT_WORKSPACE
      : LLMTaskMode.CHAT_NOVEL_EDITOR;

    const promptContext = this.buildPromptContext(userInput, language);

    let result: { contentParts: ContentPart[]; functionCalls: FunctionCallMetadata[]; thinkingDetails?: any[] } | null = null;

    this.task = new LLMTask(
      {
        mode,
        projectId: this.config.projectId,
        promptContext,
        abortControllerRef: this.config.abortControllerRef,
        sessionId: this.config.sessionId,
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
          this.callbacks.onUpdateMessage(this.config.projectId, chatId, assistantMessageId, parts, language);
        },
        onComplete: (r) => {
          result = r;
        },
        onError: (error) => {
          throw error;
        },
        onFunctionProgress: (progress) => {
          this.callbacks.onFunctionCallProgress?.(this.config.projectId, chatId, assistantMessageId, progress);
        },
      }
    );

    await this.task.run(previousHistory);

    if (result) {
      await this.finishProcessing(chatId, assistantMessageId, result, language);
    }
  }

  private buildPromptContext(
    userInput: string,
    language: string
  ): ChatWorkspacePromptContext | ChatNovelEditorPromptContext {
    const storyObjects = this.config.getStoryObjects();
    const novelData = this.config.getNovelData?.();
    const functionResults = this.config.getPendingFunctionCallResults?.() ?? [];

    const base = {
      userInput,
      outputLanguage: language,
      enablePrefill: this.config.enablePrefill,
      enableThinking: this.config.thinkingMode === 'model',
      enableCustomThinking: this.config.thinkingMode === 'custom',
      functions: this.config.functions,
      storyObjects,
      functionResults,
    };

    if (this.config.mode === 'novelEditor') {
      return {
        ...base,
        novelData,
      } as ChatNovelEditorPromptContext;
    }

    return base as ChatWorkspacePromptContext;
  }

  private async finishProcessing(
    chatId: string,
    messageId: string,
    result: { contentParts: ContentPart[]; functionCalls: FunctionCallMetadata[]; thinkingDetails?: any[] },
    language: string
  ): Promise<void> {
    // Final update
    this.callbacks.onUpdateMessage(
      this.config.projectId,
      chatId,
      messageId,
      result.contentParts,
      language,
      result.thinkingDetails
    );

    // Sync to backend
    try {
      await this.callbacks.onSyncMessageToBackend(
        this.config.projectId,
        chatId,
        messageId,
        result.contentParts,
        language,
        result.thinkingDetails
      );
    } catch (error) {
      console.error('Failed to sync message to backend:', error);
    }

    // Process function calls
    if (result.functionCalls.length > 0) {
      this.callbacks.onFunctionCalls(this.config.projectId, chatId, messageId, result.functionCalls);
    }
  }

  private handleError(error: unknown): void {
    const isAbortError = error instanceof DOMException && error.name === 'AbortError';

    if (isAbortError || this.isAborted) {
      if (this.config.sessionId) {
        useLLMTaskStore.getState().setCancelled(this.config.sessionId);
      }
    } else {
      const err = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onError(err);
      if (this.config.sessionId) {
        useLLMTaskStore.getState().setTaskError(this.config.sessionId, err.message);
      }
    }
  }

  private cleanup(): void {
    this.config.setIsLoading(false);
    this.task = null;
    this.isAborted = false;
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

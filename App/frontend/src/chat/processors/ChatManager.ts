import type { MutableRefObject } from 'react';
import type { ChatMessage, FunctionCallMetadata, ContentPart, FunctionCallProgress } from '../../llm_request/types';
import type { LLMRequestPipelineContext } from '../types';
import { streamChat } from '../../llm_request/llmService';
import { LLMRequestPipeline } from '../LLMRequestPipeline';
import { type ProviderType, type ProviderConfig, type ThinkingConfig, type RetryConfig } from '../../store/settingsStore';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import { FunctionCallStreamTracker } from '../streaming/FunctionCallStreamTracker';
import { generateTempId } from '../../utils/tempId';

export interface ChatManagerConfig {
  projectId: string;
  getStoryObjects: () => any; // Changed from static value to function
  getNovelData?: () => any; // Novel content access function
  systemInsertConfig: any;
  chatPipeline: LLMRequestPipeline;
  getIsLoading: () => boolean; // Changed to getter to prevent recreating ChatManager on loading state changes
  setIsLoading: (loading: boolean) => void;
  abortControllerRef: MutableRefObject<AbortController | null>;
  getActiveChatId: () => string | undefined;
  getConversationLanguage: () => string;
  aiModel?: string;
  temperature?: number;
  provider: ProviderType;
  providerConfig: ProviderConfig;
  providerPreference?: any; // OpenRouter provider preference
  functions?: any[]; // Function schemas for this context
  mode: 'novelEditor' | 'workspace'; // Explicit mode distinction
  enablePrefill?: boolean; // Enable assistant prefill
  thinkingMode?: 'off' | 'model' | 'custom'; // Thinking mode: off, model-native thinking, or custom prompt-based
  thinkingConfig?: ThinkingConfig;
  retryConfig?: RetryConfig; // Retry configuration for error handling
  /** Session ID for updating llmTaskStore with streaming content */
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
  private isStreaming: boolean = false;
  private isAborted: boolean = false;

  constructor(config: ChatManagerConfig, callbacks: ChatManagerCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Process initial user message and start streaming
   */
  async processUserMessage(userMessage: ChatMessage): Promise<void> {
    if (this.config.getIsLoading()) return;

    // Defensive check: prevent concurrent streams
    if (this.isStreaming) {
      console.warn('ChatManager: Attempted to start new stream while one is already in progress');
      return;
    }

    const chatId = this.config.getActiveChatId();
    if (!chatId) {
      console.error('ChatManager: No active chat selected for project', this.config.projectId);
      return;
    }

    const language = this.config.getConversationLanguage();
    this.config.setIsLoading(true);
    this.isStreaming = true;

    // Start toast notification if sessionId is provided
    if (this.config.sessionId) {
      useLLMTaskStore.getState().setRunning(this.config.sessionId, 'AI Response', 'chat');
    }

    try {
      // Add user message in the conversation language
      await this.callbacks.onAddMessage(this.config.projectId, chatId, userMessage, language);

      // Create new AI response message
      const assistantMessage = this.createAssistantMessage();
      const assistantMessageId = await this.callbacks.onAddMessage(this.config.projectId, chatId, assistantMessage, language);

      // Start streaming with the backend-generated message ID
      await this.startStreaming(chatId, assistantMessageId, language);

      // Mark toast as success
      if (this.config.sessionId) {
        useLLMTaskStore.getState().setSuccess(this.config.sessionId);
      }

    } catch (error) {
      // Don't show error for intentional abort
      const isAbortError = error instanceof DOMException && error.name === 'AbortError';
      if (isAbortError || this.isAborted) {
        console.log('Stream aborted by user');
        // Mark as cancelled for aborted streams
        if (this.config.sessionId) {
          useLLMTaskStore.getState().setCancelled(this.config.sessionId);
        }
      } else {
        console.error('LLM request processing error:', error);
        this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
        // Mark toast as error
        if (this.config.sessionId) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          useLLMTaskStore.getState().setTaskError(this.config.sessionId, errorMessage);
        }
      }
    } finally {
      this.config.setIsLoading(false);
      this.isStreaming = false;
      this.isAborted = false;  // Reset abort flag
      this.config.abortControllerRef.current = null;
    }
  }

  /**
   * Process empty request without adding user message
   */
  async processEmptyRequest(): Promise<void> {
    if (this.config.getIsLoading()) return;

    // Defensive check: prevent concurrent streams
    if (this.isStreaming) {
      console.warn('ChatManager: Attempted to start new stream while one is already in progress');
      return;
    }

    const chatId = this.config.getActiveChatId();
    if (!chatId) {
      console.error('ChatManager: No active chat selected for project', this.config.projectId);
      return;
    }

    const language = this.config.getConversationLanguage();
    this.config.setIsLoading(true);
    this.isStreaming = true;

    // Start toast notification if sessionId is provided
    if (this.config.sessionId) {
      useLLMTaskStore.getState().setRunning(this.config.sessionId, 'AI Response', 'chat');
    }

    try {
      // Create new AI response message
      const assistantMessage = this.createAssistantMessage();
      const assistantMessageId = await this.callbacks.onAddMessage(this.config.projectId, chatId, assistantMessage, language);

      // Start streaming with the backend-generated message ID
      await this.startStreaming(chatId, assistantMessageId, language);

      // Mark toast as success
      if (this.config.sessionId) {
        useLLMTaskStore.getState().setSuccess(this.config.sessionId);
      }

    } catch (error) {
      // Don't show error for intentional abort
      const isAbortError = error instanceof DOMException && error.name === 'AbortError';
      if (isAbortError || this.isAborted) {
        console.log('Stream aborted by user');
        // Mark as cancelled for aborted streams
        if (this.config.sessionId) {
          useLLMTaskStore.getState().setCancelled(this.config.sessionId);
        }
      } else {
        console.error('LLM request processing error:', error);
        this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
        // Mark toast as error
        if (this.config.sessionId) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          useLLMTaskStore.getState().setTaskError(this.config.sessionId, errorMessage);
        }
      }
    } finally {
      this.config.setIsLoading(false);
      this.isStreaming = false;
      this.isAborted = false;  // Reset abort flag
      this.config.abortControllerRef.current = null;
    }
  }


  /**
   * Create AI response message
   */
  private createAssistantMessage(): ChatMessage {
    return {
      id: generateTempId(),
      role: 'assistant',
      contentParts: [],
      timestamp: new Date(),
    };
  }

  /**
   * Start streaming
   */
  private async startStreaming(chatId: string, assistantMessageId: string, language: string): Promise<void> {
    // Get current chat history for the active chat in the target language
    const chatHistory = this.callbacks.onGetChatHistory(this.config.projectId, chatId, language);

    // Create pipeline context with fresh storyObjects and novel data
    const context = LLMRequestPipeline.createContext(
      this.config.projectId,
      this.config.getStoryObjects(),
      this.config.mode,
      this.config.systemInsertConfig,
      this.config.getNovelData?.(),
      this.config.enablePrefill,
      this.config.thinkingMode,
      this.config.thinkingConfig
    );

    // Pre-process messages
    const { conversationBlocks, functions } = await this.config.chatPipeline.preProcess(
      chatHistory.slice(0, -1),
      context,
      language,
      this.config.functions
    );

    // Start streaming
    this.config.abortControllerRef.current = new AbortController();

    // Accumulate interleaved content parts with simplified single-buffer approach
    let accumulatedContentParts: ContentPart[] = [];
    let currentPartType: 'thinking' | 'content' | null = null;
    let currentBuffer = '';
    let accumulatedThinkingDetails: any[] | undefined;
    const toolCallTracker = new FunctionCallStreamTracker(functions ?? this.config.functions);
    let finalizedToolCalls: any[] = [];

    // Helper to finalize current buffer into accumulated parts
    const finalizeCurrentBuffer = () => {
      if (currentPartType && currentBuffer) {
        accumulatedContentParts.push({type: currentPartType, text: currentBuffer});
        currentBuffer = '';
        currentPartType = null;
      }
    };

    // Throttle mechanism to prevent excessive store updates
    let pendingUpdate: ContentPart[] | null = null;
    let rafId: number | null = null;

    const scheduleUpdate = (contentParts: ContentPart[]) => {
      pendingUpdate = contentParts;

      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          if (pendingUpdate !== null) {
            this.callbacks.onUpdateMessage(this.config.projectId, chatId, assistantMessageId, pendingUpdate, language);
            // Update llmTaskStore inside RAF to prevent excessive updates
            if (this.config.sessionId) {
              useLLMTaskStore.getState().setContentParts(this.config.sessionId, pendingUpdate);
            }
            pendingUpdate = null;
          }
          rafId = null;
        });
      }
    };

    const flushPendingUpdate = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (pendingUpdate !== null) {
        this.callbacks.onUpdateMessage(this.config.projectId, chatId, assistantMessageId, pendingUpdate, language);
        // Also flush llmTaskStore update
        if (this.config.sessionId) {
          useLLMTaskStore.getState().setContentParts(this.config.sessionId, pendingUpdate);
        }
        pendingUpdate = null;
      }
    };

    // Prepare thinking config for model mode
    const thinkingConfig = this.config.thinkingMode === 'model' ? this.config.thinkingConfig : undefined;

    try {
      for await (const chunk of streamChat(
        conversationBlocks,
        this.config.provider,
        this.config.providerConfig,
        {
          signal: this.config.abortControllerRef.current.signal,
          functions: functions,
          model: this.config.aiModel,
          temperature: this.config.temperature,
          providerPreference: this.config.providerPreference,
          thinkingConfig,
          thinkingMode: this.config.thinkingMode,
          retryConfig: this.config.retryConfig,
        }
      )) {
        if (typeof chunk === 'string') {
          // Pure content string
          if (currentPartType !== 'content') {
            finalizeCurrentBuffer(); // Type changed - finalize previous buffer

            // Check if the last accumulated part is content that we should continue
            const lastPart = accumulatedContentParts[accumulatedContentParts.length - 1];
            if (lastPart && lastPart.type === 'content') {
              // Remove and prepend to continue the content block
              const previousContent = accumulatedContentParts.pop()!;
              currentBuffer = previousContent.text;
            }

            currentPartType = 'content';
          }
          currentBuffer += chunk;

          // Show content in progress
          scheduleUpdate([
            ...accumulatedContentParts,
            {type: 'content', text: currentBuffer}
          ]);
        } else {
          // Structured chunk

          // Handle thinking_text (model-native thinking chunks from backend)
          const thinkingText = (chunk as any).thinking_text;
          if (thinkingText) {
            const thinkingType = 'thinking';

            if (currentPartType !== thinkingType) {
              finalizeCurrentBuffer(); // Type changed - finalize previous buffer

              // Check if the last accumulated part is thinking to continue it
              const lastPart = accumulatedContentParts[accumulatedContentParts.length - 1];
              if (lastPart && lastPart.type === 'thinking') {
                // Remove and prepend to continue the thinking block
                const previousThinking = accumulatedContentParts.pop()!;
                currentBuffer = previousThinking.text;
              }

              currentPartType = thinkingType;
            }

            // Backend sends incremental delta, so append to buffer
            currentBuffer += thinkingText;

            // Show thinking in progress
            scheduleUpdate([
              ...accumulatedContentParts,
              {type: thinkingType, text: currentBuffer}
            ]);
          }

          // Handle content
          if (chunk.content) {
            if (currentPartType !== 'content') {
              finalizeCurrentBuffer(); // Type changed - finalize previous buffer

              // Check if the last accumulated part is content that we should continue
              const lastPart = accumulatedContentParts[accumulatedContentParts.length - 1];
              if (lastPart && lastPart.type === 'content') {
                // Remove and prepend to continue the content block
                const previousContent = accumulatedContentParts.pop()!;
                currentBuffer = previousContent.text;
              }

              currentPartType = 'content';
            }

            // Content is incremental (append)
            currentBuffer += chunk.content;

            // Show content in progress
            scheduleUpdate([
              ...accumulatedContentParts,
              {type: 'content', text: currentBuffer}
            ]);
          }

          // Handle tool calls
          if (chunk.tool_calls) {
            const progressEvents = toolCallTracker.applyDelta(chunk.tool_calls);
            if (progressEvents.length && this.callbacks.onFunctionCallProgress) {
              this.callbacks.onFunctionCallProgress(
                this.config.projectId,
                chatId,
                assistantMessageId,
                progressEvents
              );
            }
          }

          // Store thinking_details metadata
          const thinkingDetails = (chunk as any).thinking_details;
          if (thinkingDetails) {
            if (!accumulatedThinkingDetails) {
              accumulatedThinkingDetails = [];
            }
            accumulatedThinkingDetails.push(...thinkingDetails);
          }
        }
      }

      // Finalize any remaining buffer
      finalizeCurrentBuffer();

      // Ensure final update is sent
      flushPendingUpdate();
    } catch (error) {
      // Clean up RAF on error
      flushPendingUpdate();

      // For abort errors, finalize gracefully instead of rethrowing
      const isAbortError = error instanceof DOMException && error.name === 'AbortError';
      if (isAbortError || this.isAborted) {
        // Finalize what we have so far
        finalizeCurrentBuffer();
        finalizedToolCalls = toolCallTracker.finalize();

        // Post-processing with partial content
        await this.finishProcessing(
          chatId,
          assistantMessageId,
          accumulatedContentParts,
          finalizedToolCalls,
          accumulatedThinkingDetails,
          context,
          language
        );
        return;  // Exit gracefully
      }

      throw error;  // Rethrow for non-abort errors
    }

    finalizedToolCalls = toolCallTracker.finalize();

    // Post-processing
    await this.finishProcessing(
      chatId,
      assistantMessageId,
      accumulatedContentParts,
      finalizedToolCalls,
      accumulatedThinkingDetails,
      context,
      language
    );
  }

  /**
   * Final processing
   */
  private async finishProcessing(
    chatId: string,
    messageId: string,
    contentParts: ContentPart[],
    toolCalls: any[],
    thinkingDetails: any[] | undefined,
    context: LLMRequestPipelineContext,
    _language: string
  ): Promise<void> {
    // Post-process the final AI response with contentParts
    const finalResponse = (toolCalls.length > 0 || thinkingDetails)
      ? {
          content: null,
          contentParts,
          tool_calls: toolCalls,
          thinking_details: thinkingDetails
        }
      : { content: null, contentParts };

    console.log('ChatManager: Processing final response', {
      finalResponse,
      contentPartsLength: contentParts.length,
      toolCallsLength: toolCalls.length,
      hasThinkingDetails: !!thinkingDetails
    });

    const { message: processedMessage } = this.config.chatPipeline.postProcess(
      finalResponse,
      context
    );

    console.log('ChatManager: Processed message', {
      messageId,
      contentPartsLength: processedMessage.contentParts?.length || 0,
      functionCallsLength: processedMessage.functionCalls?.length || 0,
      hasThinkingDetails: !!(processedMessage as any).thinking_details
    });

    // Save the final processed message (local update first)
    this.callbacks.onUpdateMessage(
      this.config.projectId,
      chatId,
      messageId,
      processedMessage.contentParts || [],
      _language,
      (processedMessage as any).thinking_details
    );

    // Sync to backend to persist data
    try {
      await this.callbacks.onSyncMessageToBackend(
        this.config.projectId,
        chatId,
        messageId,
        processedMessage.contentParts || [],
        _language,
        (processedMessage as any).thinking_details
      );
      console.log('ChatManager: Successfully synced message to backend');
    } catch (error) {
      console.error('ChatManager: Failed to sync message to backend:', error);
      // Don't throw - local state is already updated
    }

    // Process for display and generate edit cards
    this.config.chatPipeline.processForDisplay(processedMessage, context);

    // Call callback if function calls exist
    if (processedMessage.functionCalls && processedMessage.functionCalls.length > 0) {
      console.log('ChatManager: Calling onFunctionCalls callback', { messageId, functionCalls: processedMessage.functionCalls });
      this.callbacks.onFunctionCalls(this.config.projectId, chatId, messageId, processedMessage.functionCalls);
    } else {
      console.log('ChatManager: No function calls to process');
    }
  }

  /**
   * Abort streaming
   */
  abort(): void {
    if (this.config.abortControllerRef.current) {
      this.isAborted = true;  // Mark as intentional abort
      this.config.abortControllerRef.current.abort();
      // Let finally block handle state cleanup
    }
  }
}

export function findLastUserMessageIdx(messages: ChatMessage[]): number
  {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') 
      {
        return i;
      }
    }
    return -1;
  }



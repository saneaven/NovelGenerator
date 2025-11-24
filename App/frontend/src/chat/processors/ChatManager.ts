import type { MutableRefObject } from 'react';
import type { ChatMessage, FunctionCallMetadata, ContentPart, FunctionCallProgress } from '../../llm_request/types';
import type { ChatPipelineContext } from '../types';
import { streamChat } from '../../llm_request/llmService';
import { ChatPipeline } from '../ChatPipeline';
import { type ProviderType, type ProviderConfig } from '../../store/settingsStore';
import { FunctionCallStreamTracker } from '../streaming/FunctionCallStreamTracker';

export interface ChatManagerConfig {
  projectId: string;
  getStoryObjects: () => any; // Changed from static value to function
  getNovelData?: () => any; // Novel content access function
  systemInsertConfig: any;
  chatPipeline: ChatPipeline;
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
  thinkingMode?: 'off' | 'model' | 'custom'; // Thinking mode: off, model-native reasoning, or custom prompt-based
  thinkingConfig?: {
    effort?: 'low' | 'medium' | 'high';
    maxTokens?: number;
  };
}

export interface ChatManagerCallbacks {
  onUpdateMessage: (projectId: string, chatId: string, messageId: string, contentParts: ContentPart[], language: string, reasoning_details?: any[]) => void;
  onSyncMessageToBackend: (projectId: string, chatId: string, messageId: string, contentParts: ContentPart[], language: string, reasoning_details?: any[]) => Promise<void>;
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

    try {
      // Add user message in the conversation language
      await this.callbacks.onAddMessage(this.config.projectId, chatId, userMessage, language);

      // Create new AI response message
      const assistantMessage = this.createAssistantMessage();
      const assistantMessageId = await this.callbacks.onAddMessage(this.config.projectId, chatId, assistantMessage, language);

      // Start streaming with the backend-generated message ID
      await this.startStreaming(chatId, assistantMessageId, language);

    } catch (error) {
      console.error('LLM request processing error:', error);
      this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.config.setIsLoading(false);
      this.isStreaming = false;
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

    try {
      // Create new AI response message
      const assistantMessage = this.createAssistantMessage();
      const assistantMessageId = await this.callbacks.onAddMessage(this.config.projectId, chatId, assistantMessage, language);

      // Start streaming with the backend-generated message ID
      await this.startStreaming(chatId, assistantMessageId, language);

    } catch (error) {
      console.error('LLM request processing error:', error);
      this.callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.config.setIsLoading(false);
      this.isStreaming = false;
      this.config.abortControllerRef.current = null;
    }
  }


  /**
   * Create AI response message
   */
  private createAssistantMessage(): ChatMessage {
    return {
      id: crypto.randomUUID(),
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
    const context = ChatPipeline.createContext(
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
    let accumulatedReasoningDetails: any[] | undefined;
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
        pendingUpdate = null;
      }
    };

    // Prepare reasoning config for model mode
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

          // Handle reasoning_text (thinking/reasoning chunks from backend)
          if (chunk.reasoning_text) {
            const reasoningType = 'thinking';

            if (currentPartType !== reasoningType) {
              finalizeCurrentBuffer(); // Type changed - finalize previous buffer

              // Check if the last accumulated part is reasoning/thinking to continue it
              const lastPart = accumulatedContentParts[accumulatedContentParts.length - 1];
              if (lastPart && lastPart.type === 'thinking') {
                // Remove and prepend to continue the reasoning block
                const previousReasoning = accumulatedContentParts.pop()!;
                currentBuffer = previousReasoning.text;
              }

              currentPartType = reasoningType;
            }

            // Backend sends incremental delta, so append to buffer
            currentBuffer += chunk.reasoning_text;

            // Show thinking in progress
            scheduleUpdate([
              ...accumulatedContentParts,
              {type: reasoningType, text: currentBuffer}
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

          // Store reasoning_details metadata
          if (chunk.reasoning_details) {
            if (!accumulatedReasoningDetails) {
              accumulatedReasoningDetails = [];
            }
            accumulatedReasoningDetails.push(...chunk.reasoning_details);
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
      throw error;
    }

    finalizedToolCalls = toolCallTracker.finalize();

    // Post-processing
    await this.finishProcessing(
      chatId,
      assistantMessageId,
      accumulatedContentParts,
      finalizedToolCalls,
      accumulatedReasoningDetails,
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
    reasoningDetails: any[] | undefined,
    context: ChatPipelineContext,
    _language: string
  ): Promise<void> {
    // Post-process the final AI response with contentParts
    const finalResponse = (toolCalls.length > 0 || reasoningDetails)
      ? {
          content: null,
          contentParts,
          tool_calls: toolCalls,
          reasoning_details: reasoningDetails
        }
      : { content: null, contentParts };

    console.log('ChatManager: Processing final response', {
      finalResponse,
      contentPartsLength: contentParts.length,
      toolCallsLength: toolCalls.length,
      hasReasoningDetails: !!reasoningDetails
    });

    const { message: processedMessage } = this.config.chatPipeline.postProcess(
      finalResponse,
      context
    );

    console.log('ChatManager: Processed message', {
      messageId,
      contentPartsLength: processedMessage.contentParts?.length || 0,
      functionCallsLength: processedMessage.functionCalls?.length || 0,
      hasReasoningDetails: !!(processedMessage as any).reasoning_details
    });

    // Save the final processed message (local update first)
    this.callbacks.onUpdateMessage(
      this.config.projectId,
      chatId,
      messageId,
      processedMessage.contentParts || [],
      _language,
      (processedMessage as any).reasoning_details
    );

    // Sync to backend to persist data
    try {
      await this.callbacks.onSyncMessageToBackend(
        this.config.projectId,
        chatId,
        messageId,
        processedMessage.contentParts || [],
        _language,
        (processedMessage as any).reasoning_details
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
      this.config.abortControllerRef.current.abort();
      this.config.setIsLoading(false);
      this.isStreaming = false;
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



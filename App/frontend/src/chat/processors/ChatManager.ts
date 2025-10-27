import type { MutableRefObject } from 'react';
import type { ChatMessage, FunctionCallMetadata, ContentPart } from '../../llm_request/types';
import type { ChatPipelineContext } from '../types';
import { streamChat } from '../../llm_request/llmService';
import { ChatPipeline } from '../ChatPipeline';
import { type ProviderType, type ProviderConfig } from '../../store/settingsStore';

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
  mode: 'novel-editor' | 'workspace'; // Explicit mode distinction
  enablePrefill?: boolean; // Enable assistant prefill
  thinkingMode?: 'off' | 'model' | 'custom'; // Thinking mode: off, model-native reasoning, or custom prompt-based
  reasoningConfig?: {
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
  onFunctionCallsDetected?: (projectId: string, chatId: string, messageId: string, functionCalls: any[]) => void;
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
      console.error('Chat processing error:', error);
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
      console.error('Chat processing error:', error);
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
      content: '',
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
      this.config.reasoningConfig
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

    // NEW: Accumulate interleaved content parts
    let accumulatedContentParts: ContentPart[] = [];
    let currentContentChunk = '';  // Buffer for incomplete content
    let currentThinkingChunk = '';  // Buffer for incomplete thinking (streaming)
    let accumulatedToolCalls: any[] = [];
    let accumulatedReasoningDetails: any[] | undefined;

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
    const reasoningConfig = this.config.thinkingMode === 'model' ? this.config.reasoningConfig : undefined;

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
          reasoningConfig,
          thinkingMode: this.config.thinkingMode,
        }
      )) {
        if (typeof chunk === 'string') {
          // Pure content chunk
          currentContentChunk += chunk;

          // Show content in progress
          const displayParts = [
            ...accumulatedContentParts,
            ...(currentContentChunk ? [{type: 'content' as const, text: currentContentChunk}] : [])
          ];
          scheduleUpdate(displayParts);
        } else {
          // Structured chunk
          if (chunk.content) {
            currentContentChunk += chunk.content;
          }

          // NEW: Handle reasoning_text (thinking/reasoning chunks from backend)
          if (chunk.reasoning_text) {
            const reasoningType = this.config.thinkingMode === 'custom' ? 'thinking' : 'reasoning';

            // Check if this is incremental update (same thinking block growing)
            if (currentThinkingChunk && chunk.reasoning_text.startsWith(currentThinkingChunk)) {
              // This is an incremental update to the same thinking block - just update buffer
              currentThinkingChunk = chunk.reasoning_text;
            } else {
              // New thinking block started - finalize current content chunk
              if (currentContentChunk) {
                accumulatedContentParts.push({type: 'content', text: currentContentChunk});
                currentContentChunk = '';
              }

              // Finalize previous thinking chunk if exists
              if (currentThinkingChunk) {
                accumulatedContentParts.push({type: reasoningType, text: currentThinkingChunk});
              }

              // Start new thinking chunk
              currentThinkingChunk = chunk.reasoning_text;
            }

            // Show thinking in progress (similar to content streaming)
            const displayParts = [
              ...accumulatedContentParts,
              ...(currentThinkingChunk ? [{type: reasoningType, text: currentThinkingChunk}] : [])
            ];
            scheduleUpdate(displayParts);
          }

          if (chunk.tool_calls) {
            accumulatedToolCalls = this.accumulateToolCalls(accumulatedToolCalls, chunk.tool_calls);

            if (this.callbacks.onFunctionCallsDetected) {
              this.callbacks.onFunctionCallsDetected(this.config.projectId, chatId, assistantMessageId, accumulatedToolCalls);
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

      // Flush any remaining content chunk
      if (currentContentChunk) {
        accumulatedContentParts.push({type: 'content', text: currentContentChunk});
      }

      // Flush any remaining thinking chunk
      if (currentThinkingChunk) {
        const reasoningType = this.config.thinkingMode === 'custom' ? 'thinking' : 'reasoning';
        accumulatedContentParts.push({type: reasoningType, text: currentThinkingChunk});
      }

      // Ensure final update is sent
      flushPendingUpdate();
    } catch (error) {
      // Clean up RAF on error
      flushPendingUpdate();
      throw error;
    }

    // Post-processing
    await this.finishProcessing(
      chatId,
      assistantMessageId,
      accumulatedContentParts,
      accumulatedToolCalls,
      accumulatedReasoningDetails,
      context,
      language
    );
  }

  /**
   * Accumulate tool calls
   */
  private accumulateToolCalls(existing: any[], newCalls: any[]): any[] {
    newCalls.forEach((newToolCall, index) => {
      if (!existing[index]) {
        existing[index] = {
          id: newToolCall.id || '',
          type: newToolCall.type || 'function',
          function: {
            name: newToolCall.function?.name || '',
            arguments: ''
          }
        };
      }
      
      if (newToolCall.function?.arguments) {
        existing[index].function.arguments += newToolCall.function.arguments;
      }
      
      if (newToolCall.id) existing[index].id = newToolCall.id;
      if (newToolCall.function?.name) existing[index].function.name = newToolCall.function.name;
    });
    
    return existing;
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
          contentParts,
          tool_calls: toolCalls,
          reasoning_details: reasoningDetails
        }
      : { contentParts };

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


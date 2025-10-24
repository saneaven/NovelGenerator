import type { MutableRefObject } from 'react';
import type { ChatMessage, FunctionCallMetadata } from '../../llm_request/types';
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
  isLoading: boolean;
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
  enableThinking?: boolean; // Enable extended thinking in prompts
}

export interface ChatManagerCallbacks {
  onUpdateMessage: (projectId: string, chatId: string, messageId: string, content: string, language: string) => void;
  onFunctionCalls: (projectId: string, chatId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  onAddMessage: (projectId: string, chatId: string, message: ChatMessage, language: string) => Promise<string>;
  onGetChatHistory: (projectId: string, chatId: string, language: string) => ChatMessage[];
  onError: (error: Error) => void;
  onFunctionCallsDetected?: (projectId: string, chatId: string, messageId: string, functionCalls: any[]) => void;
}

export class ChatManager {
  private config: ChatManagerConfig;
  private callbacks: ChatManagerCallbacks;

  constructor(config: ChatManagerConfig, callbacks: ChatManagerCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Process initial user message and start streaming
   */
  async processUserMessage(userMessage: ChatMessage): Promise<void> {
    if (this.config.isLoading) return;

    const chatId = this.config.getActiveChatId();
    if (!chatId) {
      console.error('ChatManager: No active chat selected for project', this.config.projectId);
      return;
    }

    const language = this.config.getConversationLanguage();
    this.config.setIsLoading(true);

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
      this.config.abortControllerRef.current = null;
    }
  }

  /**
   * Process empty request without adding user message
   */
  async processEmptyRequest(): Promise<void> {
    if (this.config.isLoading) return;

    const chatId = this.config.getActiveChatId();
    if (!chatId) {
      console.error('ChatManager: No active chat selected for project', this.config.projectId);
      return;
    }

    const language = this.config.getConversationLanguage();
    this.config.setIsLoading(true);

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
      this.config.enableThinking
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

    let accumulatedContent = '';
    let accumulatedToolCalls: any[] = [];

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
      }
    )) {
      if (typeof chunk === 'string') {
        accumulatedContent += chunk;
        this.callbacks.onUpdateMessage(this.config.projectId, chatId, assistantMessageId, accumulatedContent, language);
      } else {
        if (chunk.content) {
          accumulatedContent += chunk.content;
          this.callbacks.onUpdateMessage(this.config.projectId, chatId, assistantMessageId, accumulatedContent, language);
        }

        if (chunk.tool_calls) {
          accumulatedToolCalls = this.accumulateToolCalls(accumulatedToolCalls, chunk.tool_calls);

          if (this.callbacks.onFunctionCallsDetected) {
            this.callbacks.onFunctionCallsDetected(this.config.projectId, chatId, assistantMessageId, accumulatedToolCalls);
          }
        }
      }
    }

    // Post-processing
    await this.finishProcessing(chatId, assistantMessageId, accumulatedContent, accumulatedToolCalls, context, language);
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
    content: string,
    toolCalls: any[],
    context: ChatPipelineContext,
    _language: string
  ): Promise<void> {
    // Post-process the final AI response
    const finalResponse = toolCalls.length > 0 
      ? { content: content, tool_calls: toolCalls }
      : content;

    console.log('ChatManager: Processing final response', { finalResponse, toolCallsLength: toolCalls.length });

    const { message: processedMessage } = this.config.chatPipeline.postProcess(
      finalResponse,
      context
    );

    console.log('ChatManager: Processed message', { 
      messageId, 
      functionCallsLength: processedMessage.functionCalls?.length || 0,
      functionCalls: processedMessage.functionCalls 
    });

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


import type { ChatMessage, FunctionCallMetadata } from '../../llm_request/types';
import type { ChatPipelineContext } from '../types';
import { streamCopilot } from '../../llm_request/copilot';
import { ChatPipeline } from '../ChatPipeline';

export interface RuntimeProcessingConfig {
  projectId: string;
  getStoryObjects: () => any; // Changed from static value to function
  systemInsertConfig: any;
  chatPipeline: ChatPipeline;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  outputLanguage?: string;
  aiModel?: string;
}

export interface RuntimeProcessingCallbacks {
  onUpdateMessage: (messageId: string, content: string) => void;
  onFunctionCalls: (messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  onAddMessage: (projectId: string, message: ChatMessage) => void;
  onGetChatHistory: (projectId: string) => ChatMessage[];
  onError: (error: Error) => void;
  onFunctionCallsDetected?: (messageId: string, functionCalls: any[]) => void;
}

export class RuntimeProcessor {
  private config: RuntimeProcessingConfig;
  private callbacks: RuntimeProcessingCallbacks;

  constructor(config: RuntimeProcessingConfig, callbacks: RuntimeProcessingCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Process initial user message and start streaming
   */
  async processUserMessage(userMessage: ChatMessage): Promise<void> {
    if (this.config.isLoading) return;

    this.config.setIsLoading(true);

    try {
      // Add user message
      this.callbacks.onAddMessage(this.config.projectId, userMessage);

      // Create new AI response message
      const assistantMessage = this.createAssistantMessage();
      this.callbacks.onAddMessage(this.config.projectId, assistantMessage);

      // Start streaming
      await this.startStreaming(assistantMessage.id);

    } catch (error) {
      console.error('Runtime processing error:', error);
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
  private async startStreaming(assistantMessageId: string): Promise<void> {
    // Get current chat history
    const chatHistory = this.callbacks.onGetChatHistory(this.config.projectId);

    // Create pipeline context with fresh storyObjects
    const context = ChatPipeline.createContext(
      this.config.projectId,
      this.config.getStoryObjects(), // Get fresh story objects at streaming time
      this.config.systemInsertConfig
    );

    // Pre-process messages
    const { conversationBlocks, functions } = this.config.chatPipeline.preProcess(
      chatHistory.slice(0, -1), // Exclude the newly added empty assistant message
      context,
      this.config.outputLanguage
    );

    // Start streaming
    this.config.abortControllerRef.current = new AbortController();
    
    let accumulatedContent = '';
    let accumulatedToolCalls: any[] = [];
    
    for await (const chunk of streamCopilot(conversationBlocks, {
      signal: this.config.abortControllerRef.current.signal,
      functions: functions,
      model: this.config.aiModel
    })) {
      if (typeof chunk === 'string') {
        accumulatedContent += chunk;
        this.callbacks.onUpdateMessage(assistantMessageId, accumulatedContent);
      } else {
        // Process tool calls
        if (chunk.content) {
          accumulatedContent += chunk.content;
          this.callbacks.onUpdateMessage(assistantMessageId, accumulatedContent);
        }
        
        if (chunk.tool_calls) {
          accumulatedToolCalls = this.accumulateToolCalls(accumulatedToolCalls, chunk.tool_calls);
          
          // Notify about function calls being detected during streaming
          if (this.callbacks.onFunctionCallsDetected) {
            this.callbacks.onFunctionCallsDetected(assistantMessageId, accumulatedToolCalls);
          }
        }
      }
    }

    // Post-processing
    await this.finishProcessing(assistantMessageId, accumulatedContent, accumulatedToolCalls, context);
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
    messageId: string,
    content: string,
    toolCalls: any[],
    context: ChatPipelineContext
  ): Promise<void> {
    // Post-process the final AI response
    const finalResponse = toolCalls.length > 0 
      ? { content: content, tool_calls: toolCalls }
      : content;
    
    console.log('RuntimeProcessor: Processing final response', { finalResponse, toolCallsLength: toolCalls.length });
    
    const { message: processedMessage } = this.config.chatPipeline.postProcess(
      finalResponse,
      context
    );

    console.log('RuntimeProcessor: Processed message', { 
      messageId, 
      functionCallsLength: processedMessage.functionCalls?.length || 0,
      functionCalls: processedMessage.functionCalls 
    });

    // Process for display and generate edit cards
    const { editCards } = this.config.chatPipeline.processForDisplay(processedMessage, context);
    
    // Call callback if function calls exist
    if (processedMessage.functionCalls && processedMessage.functionCalls.length > 0) {
      console.log('RuntimeProcessor: Calling onFunctionCalls callback', { messageId, functionCalls: processedMessage.functionCalls });
      this.callbacks.onFunctionCalls(messageId, processedMessage.functionCalls);
    } else {
      console.log('RuntimeProcessor: No function calls to process');
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
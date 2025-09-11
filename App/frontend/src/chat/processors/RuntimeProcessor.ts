import type { ChatMessage, FunctionCallMetadata } from '../../llm_request/types';
import type { ChatPipelineContext } from '../types';
import { streamCopilot } from '../../llm_request/copilot';
import { ChatPipeline } from '../ChatPipeline';

export interface RuntimeProcessingConfig {
  projectId: string;
  storyObjects: any;
  systemInsertConfig: any;
  chatPipeline: ChatPipeline;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
}

export interface RuntimeProcessingCallbacks {
  onNewMessage: (messageId: string, content: string) => void;
  onNewFunctionCalls: (messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  onNewEditTags: (messageId: string, editCards: any[]) => void;
  onAddMessage: (projectId: string, message: ChatMessage) => void;
  onGetChatHistory: (projectId: string) => ChatMessage[];
  onError: (error: Error) => void;
}

export class RuntimeProcessor {
  private config: RuntimeProcessingConfig;
  private callbacks: RuntimeProcessingCallbacks;

  constructor(config: RuntimeProcessingConfig, callbacks: RuntimeProcessingCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * 초기 사용자 메시지 처리 및 스트리밍 시작
   */
  async processUserMessage(userMessage: ChatMessage): Promise<void> {
    if (this.config.isLoading) return;

    this.config.setIsLoading(true);

    try {
      // 사용자 메시지 추가
      this.callbacks.onAddMessage(this.config.projectId, userMessage);

      // 새로운 AI 응답을 위한 메시지 생성
      const assistantMessage = this.createAssistantMessage();
      this.callbacks.onAddMessage(this.config.projectId, assistantMessage);

      // 스트리밍 시작
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
   * Function call 처리 후 스트리밍을 계속 진행
   */
  async continueAfterFunctionCall(
    functionCall: FunctionCallMetadata,
    accepted: boolean,
    resultMessage: string
  ): Promise<void> {
    if (this.config.isLoading) return;

    this.config.setIsLoading(true);

    try {
      // 1. 시스템 메시지로 function call 결과 전달
      const systemMessage = this.createResultMessage(functionCall, accepted, resultMessage);
      this.callbacks.onAddMessage(this.config.projectId, systemMessage);

      // 2. 새로운 AI 응답을 위한 메시지 생성
      const assistantMessage = this.createAssistantMessage();
      this.callbacks.onAddMessage(this.config.projectId, assistantMessage);

      // 3. 스트리밍 시작
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
   * 시스템 메시지 생성
   */
  private createResultMessage(
    functionCall: FunctionCallMetadata,
    accepted: boolean,
    resultMessage: string
  ): ChatMessage {
    return {
      id: crypto.randomUUID(),
      role: 'user',
      content: `<system>Function call ${functionCall.function_name} was ${accepted ? 'accepted' : 'rejected'}. ${resultMessage}</system>`,
      timestamp: new Date(),
    };
  }

  /**
   * AI 응답 메시지 생성
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
   * 스트리밍 시작
   */
  private async startStreaming(assistantMessageId: string): Promise<void> {
    // 현재 대화 히스토리 가져오기
    const chatHistory = this.callbacks.onGetChatHistory(this.config.projectId);


    // Pipeline context 생성
    const context = ChatPipeline.createContext(
      this.config.projectId,
      this.config.storyObjects,
      this.config.systemInsertConfig
    );

    // Pre-process messages
    const { conversationBlocks, functions } = this.config.chatPipeline.preProcess(
      chatHistory.slice(0, -1), // 새로 추가한 빈 assistant 메시지 제외
      context
    );

    // 스트리밍 시작
    this.config.abortControllerRef.current = new AbortController();
    
    let accumulatedContent = '';
    let accumulatedToolCalls: any[] = [];
    
    for await (const chunk of streamCopilot(conversationBlocks, {
      signal: this.config.abortControllerRef.current.signal,
      functions: functions
    })) {
      if (typeof chunk === 'string') {
        accumulatedContent += chunk;
        this.callbacks.onNewMessage(assistantMessageId, accumulatedContent);
      } else {
        // Tool call 처리
        if (chunk.content) {
          accumulatedContent += chunk.content;
          this.callbacks.onNewMessage(assistantMessageId, accumulatedContent);
        }
        
        if (chunk.tool_calls) {
          accumulatedToolCalls = this.accumulateToolCalls(accumulatedToolCalls, chunk.tool_calls);
        }
      }
    }

    // Post-processing
    await this.finishProcessing(assistantMessageId, accumulatedContent, accumulatedToolCalls, context);
  }

  /**
   * Tool calls 누적
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
   * 최종 처리
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
    
    const { message: processedMessage } = this.config.chatPipeline.postProcess(
      finalResponse,
      context
    );

    // Process for display and generate edit cards
    const { editCards } = this.config.chatPipeline.processForDisplay(processedMessage, context);
    
    // Function calls가 있으면 콜백 호출
    if (processedMessage.functionCalls && processedMessage.functionCalls.length > 0) {
      this.callbacks.onNewFunctionCalls(messageId, processedMessage.functionCalls);
    }
    // Legacy edit tags 처리
    else if (editCards.length > 0) {
      this.callbacks.onNewEditTags(messageId, editCards);
    }
  }

  /**
   * 스트리밍 중단
   */
  abort(): void {
    if (this.config.abortControllerRef.current) {
      this.config.abortControllerRef.current.abort();
      this.config.setIsLoading(false);
    }
  }
}
import type { ChatMessage } from '../llm_request/types';
import type { 
  ChatPipelineContext,
  SystemInsertConfig,
  ProcessedChatMessage,
  EditCard,
  PreProcessor,
  PostProcessor,
  DisplayProcessor
} from './types';
import { DefaultPreProcessor } from './processors/PreProcessor';
import { DefaultPostProcessor } from './processors/PostProcessor';
import { DefaultDisplayProcessor } from './processors/DisplayProcessor';

export class ChatPipeline {
  private preProcessor: PreProcessor;
  private postProcessor: PostProcessor;
  private displayProcessor: DisplayProcessor;

  constructor(
    preProcessor?: PreProcessor,
    postProcessor?: PostProcessor,
    displayProcessor?: DisplayProcessor
  ) {
    this.preProcessor = preProcessor || new DefaultPreProcessor();
    this.postProcessor = postProcessor || new DefaultPostProcessor();
    this.displayProcessor = displayProcessor || new DefaultDisplayProcessor();
  }

  // Pre-process messages before sending to AI
  preProcess(
    messages: ChatMessage[],
    context: ChatPipelineContext,
    outputLanguage?: string
  ) {
    return this.preProcessor.process(messages, context, outputLanguage);
  }

  // Post-process AI response
  postProcess(
    aiResponse: string | { content: string | null; tool_calls?: any[] },
    context: ChatPipelineContext
  ) {
    return this.postProcessor.process(aiResponse, context);
  }

  // Process message for display
  processForDisplay(message: ProcessedChatMessage, context: ChatPipelineContext) {
    return this.displayProcessor.process(message, context);
  }

  // Create default system insert config
  static createDefaultSystemConfig(): SystemInsertConfig {
    return {
      enabled: true,
      includeProjectInfo: true,
      includeStoryObjects: true
    };
  }

  // Create pipeline context
  static createContext(
    projectId: string,
    storyObjects: any,
    systemConfig?: SystemInsertConfig
  ): ChatPipelineContext {
    return {
      projectId,
      storyObjects,
      systemInsertConfig: systemConfig || this.createDefaultSystemConfig()
    };
  }
}
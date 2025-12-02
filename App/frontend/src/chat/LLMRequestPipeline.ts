import type { ChatMessage } from '../llm_request/types';
import type {
  LLMRequestPipelineContext,
  SystemInsertConfig,
  ProcessedChatMessage,
  PreProcessor,
  PostProcessor,
  DisplayProcessor
} from './types';
import type { FunctionCallSchema } from './types/functionCalling';
import type { ThinkingConfig } from '../store/settingsStore';
import { DefaultPreProcessor } from './processors/PreProcessor';
import { DefaultPostProcessor } from './processors/PostProcessor';
import { DefaultDisplayProcessor } from './processors/DisplayProcessor';

export class LLMRequestPipeline {
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
  async preProcess(
    messages: ChatMessage[],
    context: LLMRequestPipelineContext,
    conversationLanguage?: string,
    functions?: FunctionCallSchema[]
  ) {
    return await this.preProcessor.process(messages, context, conversationLanguage, functions);
  }

  // Post-process AI response
  postProcess(
    aiResponse: string | { content: string | null; tool_calls?: any[] },
    context: LLMRequestPipelineContext
  ) {
    return this.postProcessor.process(aiResponse, context);
  }

  // Process message for display
  processForDisplay(message: ProcessedChatMessage, context: LLMRequestPipelineContext) {
    return this.displayProcessor.process(message, context);
  }

  // Create default system insert config
  static createDefaultSystemConfig(): SystemInsertConfig {
    return {
      enabled: true,
      includeProjectInfo: true,
      includeStoryObjects: true,
      includeNovelContent: false,
      promptType: 'chat' // Default to chat prompt type
    };
  }

  // Create pipeline context
  static createContext(
    projectId: string,
    storyObjects: any,
  mode: 'novelEditor' | 'workspace',
  systemConfig?: SystemInsertConfig,
  novelData?: any,
  enablePrefill?: boolean,
  thinkingMode?: 'off' | 'model' | 'custom',
  thinkingConfig?: ThinkingConfig
): LLMRequestPipelineContext {
  return {
      projectId,
      storyObjects,
      systemInsertConfig: systemConfig || this.createDefaultSystemConfig(),
      novelData,
      mode,
      enablePrefill,
      thinkingMode,
      thinkingConfig
    };
  }
}

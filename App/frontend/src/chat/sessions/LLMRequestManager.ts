import type { MutableRefObject } from 'react';
import type {
  ChatMessage,
  ContentPart,
  ContentPartType,
  FunctionCallMetadata,
  FunctionCallProgress,
} from '../../llm_request/types';
import { streamChat } from '../../llm_request/llmService';
import type { ProviderConfig, ProviderType, ThinkingConfig, RetryConfig } from '../../store/settingsStore';
import { ChatPipeline } from '../ChatPipeline';
import type {
  ChatPipelineContext,
  ProcessedChatMessage,
  SystemInsertConfig,
} from '../types';
import { FunctionCallStreamTracker } from '../streaming/FunctionCallStreamTracker';
import { generateTempId } from '../../utils/tempId';

export interface LLMRequestManagerConfig {
  projectId: string;
  getStoryObjects: () => any;
  getNovelData?: () => any;
  systemInsertConfig: SystemInsertConfig;
  chatPipeline: ChatPipeline;
  provider: ProviderType;
  providerConfig: ProviderConfig;
  aiModel?: string;
  temperature?: number;
  providerPreference?: any;
  functions?: any[];
  mode: 'novelEditor' | 'workspace';
  enablePrefill?: boolean;
  thinkingMode?: 'off' | 'model' | 'custom';
  thinkingConfig?: ThinkingConfig;
  retryConfig?: RetryConfig;
  abortControllerRef: MutableRefObject<AbortController | null>;
}

export interface LLMRequestManagerCallbacks {
  onStreamUpdate: (contentParts: ContentPart[]) => void;
  onFunctionCallProgress?: (progress: FunctionCallProgress[]) => void;
  onFunctionCalls?: (functionCalls: FunctionCallMetadata[]) => Promise<void> | void;
  onFinalMessage?: (message: ProcessedChatMessage) => void;
  onError: (error: Error) => void;
}

export interface LLMRequestManagerOptions {
  history?: ChatMessage[];
  language: string;
}

export class LLMRequestManager {
  private isStreaming = false;
  private readonly config: LLMRequestManagerConfig;
  private readonly callbacks: LLMRequestManagerCallbacks;

  constructor(
    config: LLMRequestManagerConfig,
    callbacks: LLMRequestManagerCallbacks
  ) {
    this.config = config;
    this.callbacks = callbacks;
  }

  async run(userMessage: ChatMessage | null, options: LLMRequestManagerOptions): Promise<void> {
    if (this.isStreaming) {
      console.warn('LLMRequestManager: Attempted to start a task while one is already running');
      return;
    }

    const language = options.language;
    const history = options.history ?? [];
    const assistantMessage: ChatMessage = {
      id: generateTempId(),
      role: 'assistant',
      contentParts: [],
      timestamp: new Date(),
    };

    // Only add userMessage to history if provided
    const chatHistory = userMessage
      ? [...history, userMessage, assistantMessage]
      : [...history, assistantMessage];

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

    const { conversationBlocks, functions } = await this.config.chatPipeline.preProcess(
      chatHistory.slice(0, -1),
      context,
      language,
      this.config.functions
    );

    this.isStreaming = true;
    this.config.abortControllerRef.current = new AbortController();

    const collectedContentParts: ContentPart[] = [];
    let currentPartType: ContentPartType | null = null;
    let currentBuffer = '';
    let accumulatedThinkingDetails: any[] | undefined;
    const toolCallTracker = new FunctionCallStreamTracker(functions ?? this.config.functions);
    let finalizedToolCalls: any[] = [];

    const finalizeCurrentBuffer = () => {
      if (currentPartType && currentBuffer) {
        collectedContentParts.push({ type: currentPartType, text: currentBuffer });
        currentBuffer = '';
        currentPartType = null;
      }
    };

    const emitUpdate = (nextParts: ContentPart[]) => {
      this.callbacks.onStreamUpdate(nextParts);
    };

    const thinkingType: ContentPartType = 'thinking';

    try {
      for await (const chunk of streamChat(
        conversationBlocks,
        this.config.provider,
        this.config.providerConfig,
        {
          signal: this.config.abortControllerRef.current.signal,
          functions,
          model: this.config.aiModel,
          temperature: this.config.temperature,
          providerPreference: this.config.providerPreference,
          thinkingConfig: this.config.thinkingMode === 'model' ? this.config.thinkingConfig : undefined,
          thinkingMode: this.config.thinkingMode,
          retryConfig: this.config.retryConfig,
        }
      )) {
        if (typeof chunk === 'string') {
          if (currentPartType !== 'content') {
            finalizeCurrentBuffer();
            const lastPart = collectedContentParts[collectedContentParts.length - 1];
            if (lastPart && lastPart.type === 'content') {
              const previous = collectedContentParts.pop()!;
              currentBuffer = previous.text;
            }
            currentPartType = 'content';
          }
          currentBuffer += chunk;
          emitUpdate([
            ...collectedContentParts,
            { type: 'content', text: currentBuffer },
          ]);
          continue;
        }

        const thinkingText = (chunk as any).thinking_text;
        if (thinkingText) {
          if (currentPartType !== thinkingType) {
            finalizeCurrentBuffer();
            const lastPart = collectedContentParts[collectedContentParts.length - 1];
            if (lastPart && lastPart.type === 'thinking') {
              const previous = collectedContentParts.pop()!;
              currentBuffer = previous.text;
            }
            currentPartType = thinkingType;
          }
          currentBuffer += thinkingText;
          emitUpdate([
            ...collectedContentParts,
            { type: thinkingType, text: currentBuffer },
          ]);
        }

        if (chunk.content) {
          if (currentPartType !== 'content') {
            finalizeCurrentBuffer();
            const lastPart = collectedContentParts[collectedContentParts.length - 1];
            if (lastPart && lastPart.type === 'content') {
              const previous = collectedContentParts.pop()!;
              currentBuffer = previous.text;
            }
            currentPartType = 'content';
          }
          currentBuffer += chunk.content;
          emitUpdate([
            ...collectedContentParts,
            { type: 'content', text: currentBuffer },
          ]);
        }

        if (chunk.tool_calls) {
          const progressEvents = toolCallTracker.applyDelta(chunk.tool_calls);
          if (progressEvents.length && this.callbacks.onFunctionCallProgress) {
            this.callbacks.onFunctionCallProgress(progressEvents);
          }
        }

        const thinkingDetails = (chunk as any).thinking_details;
        if (thinkingDetails) {
          if (!accumulatedThinkingDetails) {
            accumulatedThinkingDetails = [];
          }
          accumulatedThinkingDetails.push(...thinkingDetails);
        }
      }

      finalizeCurrentBuffer();
      emitUpdate([...collectedContentParts]);
      finalizedToolCalls = toolCallTracker.finalize();

      await this.finishProcessing(
        collectedContentParts,
        finalizedToolCalls,
        accumulatedThinkingDetails,
        context,
        language
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onError(err);
      throw err;
    } finally {
      this.isStreaming = false;
      if (this.config.abortControllerRef.current) {
        this.config.abortControllerRef.current = null;
      }
    }
  }

  abort(): void {
    if (this.config.abortControllerRef.current) {
      this.config.abortControllerRef.current.abort();
      this.config.abortControllerRef.current = null;
    }
    this.isStreaming = false;
  }

  private async finishProcessing(
    contentParts: ContentPart[],
    toolCalls: any[],
    thinkingDetails: any[] | undefined,
    context: ChatPipelineContext,
    _language: string
  ): Promise<void> {
    const finalResponse = toolCalls.length > 0 || thinkingDetails
      ? {
          content: null,
          contentParts,
          tool_calls: toolCalls,
          thinking_details: thinkingDetails,
        }
      : { content: null, contentParts };

    const { message: processedMessage } = this.config.chatPipeline.postProcess(
      finalResponse,
      context
    );

    this.callbacks.onFinalMessage?.(processedMessage);

    if (processedMessage.functionCalls && processedMessage.functionCalls.length > 0) {
      await this.callbacks.onFunctionCalls?.(processedMessage.functionCalls);
    }
  }
}

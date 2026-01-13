import type { ConversationBlock, ContentPart, FunctionCallProgress, ChatMessage } from '../llm/requestTypes';
import type { FunctionCallSchema } from '../functionCall';
import type { LLMTaskModeType, OutputMode, PromptContext, LLMTaskResult } from '../llm/types';
import type { ProviderType, ProviderConfig, ThinkingConfig, CustomApiFormat, RetryConfig } from '../store/settingsStore';
import { LLMTask } from '../llm/LLMTask';

/**
 * Simplified config for LLMTaskExecutor
 * Does not include abortController - executor manages its own
 */
export interface ExecutorConfig {
  mode: LLMTaskModeType;
  projectId: string;
  promptContext: PromptContext;

  // Pre-built messages (for multi-turn conversations)
  prepared?: {
    messages: ConversationBlock[];
    functions?: FunctionCallSchema[];
    outputMode: OutputMode;
  };

  // Provider overrides
  provider?: ProviderType;
  providerConfig?: ProviderConfig;
  model?: string;
  temperature?: number;
  thinkingMode?: 'off' | 'model' | 'custom';
  thinkingConfig?: ThinkingConfig;
  customApiFormat?: CustomApiFormat;
  retryConfig?: RetryConfig;
}

/**
 * Callbacks for executor streaming updates
 */
export interface ExecutorCallbacks {
  onStreamingUpdate?: (parts: ContentPart[]) => void;
  onFunctionProgress?: (progress: FunctionCallProgress[]) => void;
  onComplete: (result: LLMTaskResult) => void;
  onError?: (error: Error) => void;
}

/**
 * LLMTaskExecutor - Pure LLM execution wrapper
 *
 * Responsibilities:
 * - Manage AbortController lifecycle
 * - Wrap LLMTask with cleaner interface
 * - Provide abort() method
 *
 * NOT responsible for:
 * - Session management
 * - Notifications
 * - Store updates
 */
export class LLMTaskExecutor {
  private readonly abortController: AbortController;
  private task: LLMTask | null = null;

  constructor() {
    this.abortController = new AbortController();
  }

  /**
   * Execute an LLM task with the given config and callbacks
   */
  async execute(
    config: ExecutorConfig,
    callbacks: ExecutorCallbacks,
    history: ChatMessage[] = []
  ): Promise<void> {
    this.task = new LLMTask(
      {
        mode: config.mode,
        projectId: config.projectId,
        promptContext: config.promptContext,
        abortController: this.abortController,
        prepared: config.prepared,
        provider: config.provider,
        providerConfig: config.providerConfig,
        model: config.model,
        temperature: config.temperature,
        thinkingMode: config.thinkingMode,
        thinkingConfig: config.thinkingConfig,
        customApiFormat: config.customApiFormat,
        retryConfig: config.retryConfig,
      },
      {
        onUpdate: callbacks.onStreamingUpdate ?? (() => {}),
        onFunctionProgress: callbacks.onFunctionProgress,
        onComplete: callbacks.onComplete,
        onError: callbacks.onError ?? (() => {}),
      }
    );

    await this.task.run(history);
  }

  /**
   * Abort the running task
   */
  abort(): void {
    this.abortController.abort();
    this.task?.abort();
  }

  /**
   * Get the abort signal for external use
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }
}

// Re-export types for convenience
export type { LLMTaskResult };

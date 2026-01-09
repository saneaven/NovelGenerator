import type {
  ChatMessage,
  ContentPart,
  ContentPartType,
  ConversationBlock,
  FunctionCallMetadata,
  FunctionCallProgress,
} from './requestTypes';
import { streamLLM } from './llmService';
import { useSettingsStore, type AIFunctionType } from '../store/settingsStore';
import { useLLMLogStore } from '../store/llmLogStore';
import { FunctionCallStreamTracker } from '../agent/streaming/FunctionCallStreamTracker';
import { PromptManager } from './PromptManager';
import type {
  LLMTaskConfig,
  LLMTaskCallbacks,
  LLMTaskResult,
  OutputMode,
  PromptBundle,
  LLMTaskModeType,
} from './types';
import { LLMTaskMode } from './types';

/**
 * Map LLMTaskMode to AIFunctionType for settings lookup
 */
const MODE_TO_FUNCTION_TYPE: Record<LLMTaskModeType, AIFunctionType> = {
  [LLMTaskMode.AGENT_STORYOBJECT]: 'agent',
  [LLMTaskMode.AGENT_NOVEL_EDITOR]: 'agent',
  [LLMTaskMode.AGENT_OUTLINE_MANAGER]: 'agent',
  [LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT]: 'editAssistant',
  [LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT]: 'editAssistant',
  [LLMTaskMode.TRANSLATION]: 'translation',
  [LLMTaskMode.AGENT_TRANSLATION]: 'translation',
  [LLMTaskMode.OBJECT_IMAGE_PROMPT]: 'imagePrompt',
  [LLMTaskMode.SCENE_IMAGE_PROMPT]: 'imagePrompt',
  [LLMTaskMode.COVER_IMAGE_PROMPT]: 'imagePrompt',
};

/**
 * LLMTask - Core streaming class with RAF throttling
 *
 * Responsibilities:
 * - Message preparation (template rendering via PromptManager)
 * - Stream LLM response via streamChat()
 * - Content part accumulation (thinking, content)
 * - RAF-throttled updates (callback)
 * - Tool call tracking via FunctionCallStreamTracker
 * - Abort handling
 */
export class LLMTask {
  private readonly config: LLMTaskConfig;
  private readonly callbacks: LLMTaskCallbacks;
  private rafId: number | null = null;
  private pendingParts: ContentPart[] = [];
  private isRunning = false;
  private functionTracker: FunctionCallStreamTracker | null = null;
  private progressRafId: number | null = null;
  private pendingProgress: FunctionCallProgress[] | null = null;

  constructor(config: LLMTaskConfig, callbacks: LLMTaskCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Run the LLM task with the given message history
   * @param history - Optional message history (AgentManager passes this, modals don't)
   */
  async run(history: ChatMessage[] = []): Promise<void> {
    if (this.isRunning) {
      console.warn('LLMTask: Already running');
      return;
    }

    this.isRunning = true;
    this.pendingParts = [];

    // Initialize logging variables outside try block for catch block access
    const logStore = useLLMLogStore.getState();
    const settingsStore = useSettingsStore.getState();
    const isLoggingEnabled = settingsStore.settings.llmLoggingEnabled;
    let logEntryId: string | undefined;
    const requestStartTime = Date.now();

    try {
      // 1. Get provider/model config (from settings or overrides)
      const { settings, getProviderConfig } = settingsStore;

      // Get function type for this mode to lookup settings
      const functionType = MODE_TO_FUNCTION_TYPE[this.config.mode];
      const functionConfig = settings.functionConfigs[functionType];

      const provider = this.config.provider ?? functionConfig.provider;
      const providerConfig = this.config.providerConfig ?? getProviderConfig(provider);
      const model = this.config.model ?? functionConfig.model;
      const temperature = this.config.temperature ?? functionConfig.temperature;
      const thinkingMode = this.config.thinkingMode ?? functionConfig.advanced.thinkingMode;
      const thinkingConfig = this.config.thinkingConfig ?? functionConfig.advanced.thinkingConfig;
      const customApiFormat = this.config.customApiFormat ?? functionConfig.advanced.customApiFormat;
      const retryConfig = this.config.retryConfig ?? settings.retryConfig;

      // 2. Generate prompt bundle
      const promptBundle = await PromptManager.generatePromptBundle(
        this.config.mode,
        this.config.promptContext
      );

      // 3. Get functions for this mode
      const functions = PromptManager.getFunctionsForMode(
        this.config.mode,
        this.config.promptContext
      );

      const context: any = this.config.promptContext;
      const outputMode: OutputMode =
        context?.outputMode ??
        (context?.isNativeOutput === true
          ? (this.config.mode === LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT ||
              this.config.mode === LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT ||
              this.config.mode === LLMTaskMode.TRANSLATION
              ? 'native_function_call'
              : 'raw_output')
          : 'tool_call');

      const nativeFunctionCall = outputMode === 'native_function_call';

      if (outputMode !== 'tool_call' && functions?.length) {
        throw new Error(`${outputMode} requires functions to be omitted`);
      }

      // 4. Prepare messages
      const messages = await this.prepareMessages(history, promptBundle);

      // Log LLM request structure for debugging
      console.log('LLM Request:', {
        mode: this.config.mode,
        provider,
        model,
        temperature,
        thinkingMode,
        outputMode,
        functions,
        messages,
      });

      // Log to LLM Log Store if enabled
      if (isLoggingEnabled) {
        logEntryId = logStore.addLogEntry({
          status: 'pending',
          request: {
            mode: this.config.mode,
            provider,
            model,
            temperature,
            thinkingMode,
            outputMode,
            functions,
            messages,
          },
        });
      }

      // 5. Initialize function tracker
      this.functionTracker = new FunctionCallStreamTracker();

      // 7. Stream with RAF throttling
      let currentPartType: ContentPartType | null = null;
      let currentBuffer = '';
      let accumulatedThinkingDetails: any[] | undefined;
      let capturedUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;

      const finalizeCurrentBuffer = () => {
        if (currentPartType && currentBuffer) {
          this.pendingParts.push({ type: currentPartType, text: currentBuffer });
          currentBuffer = '';
          currentPartType = null;
        }
      };

      // Update log entry to streaming
      if (logEntryId) {
        logStore.updateLogEntry(logEntryId, { status: 'streaming' });
      }

      for await (const chunk of streamLLM(
        messages,
        provider,
        providerConfig,
        {
          signal: this.config.abortController.signal,
          functions,
          model,
          temperature,
          thinkingConfig: thinkingMode === 'model' ? thinkingConfig : undefined,
          thinkingMode,
          customApiFormat,
          retryConfig,
          nativeFunctionCall,
        }
      )) {
        // Handle string chunk (content)
        if (typeof chunk === 'string') {
          // Apply trimStart() on first chunk after type switch
          const isTypeSwitch = currentPartType !== 'content';
          const chunkToAdd = isTypeSwitch ? chunk.trimStart() : chunk;

          if (isTypeSwitch) {
            finalizeCurrentBuffer();
            // Merge with last content part if exists
            const lastPart = this.pendingParts[this.pendingParts.length - 1];
            if (lastPart && lastPart.type === 'content') {
              this.pendingParts.pop();
              currentBuffer = lastPart.text;
            }
            currentPartType = 'content';
          }
          currentBuffer += chunkToAdd;

          // Schedule RAF update with current state
          const currentParts = [
            ...this.pendingParts,
            { type: 'content' as ContentPartType, text: currentBuffer },
          ];
          this.pendingParts = currentParts.slice(0, -1);
          if (this.rafId === null) {
            this.rafId = requestAnimationFrame(() => {
              this.rafId = null;
              this.callbacks.onUpdate([
                ...this.pendingParts,
                { type: 'content', text: currentBuffer },
              ]);
            });
          }
          continue;
        }

        // Handle thinking chunk
        const thinkingText = (chunk as any).thinking_text;
        if (thinkingText) {
          // Apply trimStart() on first chunk after type switch
          const isTypeSwitch = currentPartType !== 'thinking';
          const textToAdd = isTypeSwitch ? thinkingText.trimStart() : thinkingText;

          if (isTypeSwitch) {
            finalizeCurrentBuffer();
            const lastPart = this.pendingParts[this.pendingParts.length - 1];
            if (lastPart && lastPart.type === 'thinking') {
              this.pendingParts.pop();
              currentBuffer = lastPart.text;
            }
            currentPartType = 'thinking';
          }
          currentBuffer += textToAdd;

          if (this.rafId === null) {
            this.rafId = requestAnimationFrame(() => {
              this.rafId = null;
              this.callbacks.onUpdate([
                ...this.pendingParts,
                { type: 'thinking', text: currentBuffer },
              ]);
            });
          }
        }

        // Handle content in object form
        if (chunk.content) {
          // Apply trimStart() on first chunk after type switch
          const isTypeSwitch = currentPartType !== 'content';
          const contentToAdd = isTypeSwitch ? chunk.content.trimStart() : chunk.content;

          if (isTypeSwitch) {
            finalizeCurrentBuffer();
            const lastPart = this.pendingParts[this.pendingParts.length - 1];
            if (lastPart && lastPart.type === 'content') {
              this.pendingParts.pop();
              currentBuffer = lastPart.text;
            }
            currentPartType = 'content';
          }
          currentBuffer += contentToAdd;

          if (this.rafId === null) {
            this.rafId = requestAnimationFrame(() => {
              this.rafId = null;
            this.callbacks.onUpdate([
              ...this.pendingParts,
              { type: 'content', text: currentBuffer },
            ]);
            });
          }
        }

        // Handle tool calls (RAF-throttled to prevent "Maximum update depth exceeded")
        if (chunk.tool_calls && this.functionTracker) {
          const progressEvents = this.functionTracker.applyDelta(chunk.tool_calls);
          if (progressEvents.length && this.callbacks.onFunctionProgress) {
            this.pendingProgress = progressEvents;
            if (this.progressRafId === null) {
              this.progressRafId = requestAnimationFrame(() => {
                this.progressRafId = null;
                if (this.pendingProgress && this.callbacks.onFunctionProgress) {
                  this.callbacks.onFunctionProgress(this.pendingProgress);
                }
              });
            }
          }
        }

        // Handle thinking details
        const thinkingDetails = (chunk as any).thinking_details;
        if (thinkingDetails) {
          if (!accumulatedThinkingDetails) {
            accumulatedThinkingDetails = [];
          }
          accumulatedThinkingDetails.push(...thinkingDetails);
        }

        // Handle usage information
        const usage = (chunk as any).usage;
        if (usage) {
          capturedUsage = usage;
        }
      }

      // 8. Finalize
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      // Flush any pending progress updates
      if (this.progressRafId !== null) {
        cancelAnimationFrame(this.progressRafId);
        this.progressRafId = null;
      }
      if (this.pendingProgress && this.callbacks.onFunctionProgress) {
        this.callbacks.onFunctionProgress(this.pendingProgress);
        this.pendingProgress = null;
      }

      finalizeCurrentBuffer();

      // Final update
      this.callbacks.onUpdate([...this.pendingParts]);

      // 9. Complete with results
      const rawFunctionCalls = this.functionTracker?.finalize() ?? [];
      const functionCalls: FunctionCallMetadata[] = rawFunctionCalls.map((fc: any) => ({
        id: fc.id,
        function_name: fc.function?.name ?? '',
        arguments: this.parseArguments(fc.function?.arguments),
        status: 'pending',
      }));
      const result: LLMTaskResult = {
        contentParts: [...this.pendingParts],
        functionCalls,
        thinkingDetails: accumulatedThinkingDetails,
        provider,
        model,
        usage: capturedUsage,
      };

      // Log streaming completion
      console.log('✅ LLM Streaming Complete:', {
        success: true,
        contentParts: [...this.pendingParts],
        functionCallCount: functionCalls.length,
        functionCalls,
      });

      // Update log entry to success
      if (logEntryId) {
        logStore.updateLogEntry(logEntryId, {
          status: 'success',
          durationMs: Date.now() - requestStartTime,
          response: {
            contentParts: [...this.pendingParts],
            functionCalls,
            thinkingDetails: accumulatedThinkingDetails,
          },
        });
      }

      await this.callbacks.onComplete(result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Log streaming failure
      console.log('LLM Streaming Failed:', {
        success: false,
        error: err.message,
        contentParts: [...this.pendingParts],
      });

      // Update log entry to error
      if (logEntryId) {
        logStore.updateLogEntry(logEntryId, {
          status: 'error',
          durationMs: Date.now() - requestStartTime,
          error: err.message,
        });
      }

      this.callbacks.onError(err);
      throw err;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Abort the running task
   */
  abort(): void {
    this.config.abortController.abort();
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.progressRafId !== null) {
      cancelAnimationFrame(this.progressRafId);
      this.progressRafId = null;
    }
    this.isRunning = false;
  }

  /**
   * Prepare messages from history and prompt bundle
   */
  private async prepareMessages(
    history: ChatMessage[],
    promptBundle: PromptBundle
  ): Promise<ConversationBlock[]> {
    const messages: ConversationBlock[] = [];
    const { settings } = useSettingsStore.getState();
    const fcLimit = settings.functionCallHistoryLimit;

    // 1. System prompt
    messages.push({
      role: 'system',
      contentParts: [{ type: 'content', text: promptBundle.systemPrompt }],
    });

    // 2. Count assistant messages to determine which ones should include function calls
    // (we include function calls from the last N assistant messages)
    const assistantIndices: number[] = [];
    for (let i = 0; i < history.length; i++) {
      if (history[i].role === 'assistant') {
        assistantIndices.push(i);
      }
    }
    const totalAssistants = assistantIndices.length;

    // 3. Process history (all previous messages - AgentManager passes history without current user message)
    let assistantCount = 0;
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];

      if (msg.role === 'user' && promptBundle.nonLastUserPrompt) {
        // Render non-last user message with template, inheriting all templateData but overriding userMessage
        const rendered = PromptManager.renderTemplate(promptBundle.nonLastUserPrompt, {
          ...promptBundle.templateData,
          input: {
            ...promptBundle.templateData.input,
            userMessage: this.getMessageText(msg),
          },
        });
        messages.push({
          role: 'user',
          contentParts: [{ type: 'content', text: rendered }],
        });
      } else if (msg.role === 'assistant') {
        // For assistant messages, potentially include tool_calls
        assistantCount++;

        // Determine if we should include function calls for this message
        // fcLimit: 0 = none, -1 = all, N = last N assistant messages
        const shouldIncludeFC = fcLimit === -1 ||
          (fcLimit > 0 && assistantCount > totalAssistants - fcLimit);

        const block: ConversationBlock = {
          role: msg.role,
          contentParts: msg.contentParts.length > 0
            ? msg.contentParts
            : [{ type: 'content', text: '' }],
        };

        // Add tool_calls if applicable
        if (shouldIncludeFC && msg.functionCalls && msg.functionCalls.length > 0) {
          block.tool_calls = msg.functionCalls.map(fc => ({
            id: fc.id,
            type: 'function' as const,
            function: {
              name: fc.function_name,
              arguments: typeof fc.arguments === 'string'
                ? fc.arguments
                : JSON.stringify(fc.arguments),
            },
          }));
        }

        messages.push(block);

        // Add tool_results message if this assistant message had tool_calls with results
        if (block.tool_calls && block.tool_calls.length > 0 && msg.functionCalls) {
          const toolResults = msg.functionCalls
            .filter(fc => fc.status !== 'pending')
            .map(fc => {
              let content: string;
              switch (fc.status) {
                case 'accepted':
                  content = fc.result?.message || 'Applied successfully';
                  break;
                case 'rejected':
                  content = fc.reason ? `User rejected: ${fc.reason}` : 'User rejected this action';
                  break;
                case 'failed':
                  content = `Failed: ${fc.reason || 'Unknown error'}`;
                  break;
                default:
                  content = 'Pending user confirmation';
              }
              return {
                tool_call_id: fc.id,
                function_name: fc.function_name,
                content,
              };
            });

          if (toolResults.length > 0) {
            messages.push({
              role: 'tool_results' as const,
              contentParts: [],  // Required by ConversationBlock but not used for tool_results
              tool_results: toolResults,
            });
          }
        }
      } else {
        // Use raw message content for other roles
        messages.push({
          role: msg.role,
          contentParts: msg.contentParts.length > 0
            ? msg.contentParts
            : [{ type: 'content', text: '' }],
        });
      }
    }

    // 4. Last user message (rendered from userPrompt template with userRequest)
    messages.push({
      role: 'user',
      contentParts: [{ type: 'content', text: promptBundle.userPrompt }],
    });

    // 5. Prefill (if configured)
    if (promptBundle.prefill) {
      messages.push({
        role: 'assistant',
        contentParts: [{ type: 'content', text: promptBundle.prefill }],
      });
    }

    return messages;
  }

  /**
   * Get text content from a message
   */
  private getMessageText(msg: ChatMessage): string {
    return msg.contentParts
      .filter((p: ContentPart) => p.type === 'content')
      .map((p: ContentPart) => p.text)
      .join('');
  }

  /**
   * Parse function call arguments from JSON string to object
   */
  private parseArguments(args: string | undefined): any {
    if (!args) return {};
    try {
      return JSON.parse(args);
    } catch {
      console.error('Failed to parse function call arguments:', args);
      return {};
    }
  }
}

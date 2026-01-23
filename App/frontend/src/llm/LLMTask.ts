import type {
  ChatMessage,
  ContentPart,
  ContentPartType,
  ConversationBlock,
  ToolCallMetadata,
  ToolCallProgress,
} from './requestTypes';
import { streamLLM } from './llmService';
import { useSettingsStore, type AITaskType } from '../store/settingsStore';
import { useLLMLogStore } from '../store/llmLogStore';
import { ToolCallStreamTracker } from '../agent/streaming/ToolCallStreamTracker';
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
import { useCredentialsStore } from '../store/credentialsStore';

/**
 * Map LLMTaskMode to AITaskType for settings lookup
 */
const MODE_TO_TASK_TYPE: Record<LLMTaskModeType, AITaskType> = {
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
 * LLMTask - Core streaming class with interval-based smoothing
 *
 * Responsibilities:
 * - Message preparation (template rendering via PromptManager)
 * - Stream LLM response via streamChat()
 * - Content part accumulation (thinking, content)
 * - Interval-based updates for smooth streaming (50ms cadence)
 * - Tool call tracking via ToolCallStreamTracker
 * - Abort handling
 */
export class LLMTask {
  private readonly config: LLMTaskConfig;
  private readonly callbacks: LLMTaskCallbacks;
  private pendingParts: ContentPart[] = [];
  private isRunning = false;
  private toolTracker: ToolCallStreamTracker | null = null;
  private pendingProgress: ToolCallProgress[] | null = null;

  // Interval-based smoothing for consistent update cadence
  private updateIntervalId: number | null = null;
  private pendingContentUpdate = false;
  private pendingProgressUpdate = false;
  private readonly UPDATE_INTERVAL_MS = 50;

  constructor(config: LLMTaskConfig, callbacks: LLMTaskCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Run the LLM task with the given message history
   * @param history - Optional message history (AgentManager passes this, modals don't)
   */
  async run(history: ChatMessage[] = []): Promise<LLMTaskResult> {
    if (this.isRunning) {
      console.warn('LLMTask: Already running');
      throw new Error('LLMTask: Already running');
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
      const { settings } = settingsStore;
      const credentialsStore = useCredentialsStore.getState();

      // Get task type for this mode to lookup settings
      const taskType = MODE_TO_TASK_TYPE[this.config.mode];
      const taskConfig = settings.taskConfigs[taskType];

      const provider = this.config.provider ?? taskConfig.provider;
      const providerConfig = this.config.providerConfig ?? credentialsStore.getProviderConfigForBackend(provider);
      const model = this.config.model ?? taskConfig.model;
      const temperature = this.config.temperature ?? taskConfig.temperature;
      const thinkingMode = this.config.thinkingMode ?? taskConfig.advanced.thinkingMode;
      const thinkingConfig = this.config.thinkingConfig ?? taskConfig.advanced.thinkingConfig;
      const customApiFormat = this.config.customApiFormat ?? taskConfig.advanced.customApiFormat;
      const retryConfig = this.config.retryConfig ?? settings.retryConfig;

      // 2. Generate prompt bundle
      const promptBundle = await PromptManager.generatePromptBundle(
        this.config.mode,
        this.config.promptContext
      );

      // 3. Get tools for this mode
      const tools = PromptManager.getToolsForMode(
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
              ? 'native_tool_call'
              : 'raw_output')
          : 'tool_call');

      // 4. Prepare messages
      const messages = await this.prepareMessages(history, promptBundle);

      const nativeToolCall = outputMode === 'native_tool_call';

      if (outputMode !== 'tool_call' && tools?.length) {
        throw new Error(`${outputMode} requires tools to be omitted`);
      }

      // Log LLM request structure for debugging
      console.log('LLM Request:', {
        mode: this.config.mode,
        provider,
        model,
        temperature,
        thinkingMode,
        outputMode,
        tools,
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
            tools,
            messages,
          },
        });
      }

      // 5. Initialize function tracker
      this.toolTracker = new ToolCallStreamTracker();

      // 7. Stream with interval-based smoothing for consistent update cadence
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

      // Start interval-based update loop for smooth streaming
      const startUpdateInterval = () => {
        if (this.updateIntervalId === null) {
          this.updateIntervalId = window.setInterval(() => {
            // Update content if pending
            if (this.pendingContentUpdate) {
              this.pendingContentUpdate = false;
              if (currentPartType && currentBuffer) {
                const currentParts = [
                  ...this.pendingParts,
                  { type: currentPartType, text: currentBuffer },
                ];
                this.callbacks.onUpdate(currentParts);
              }
            }
            // Update tool call progress if pending
            if (this.pendingProgressUpdate && this.pendingProgress) {
              this.pendingProgressUpdate = false;
              if (this.callbacks.onToolCallProgress) {
                this.callbacks.onToolCallProgress(this.pendingProgress);
              }
            }
          }, this.UPDATE_INTERVAL_MS);
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
          tools,
          model,
          temperature,
          thinkingConfig: thinkingMode === 'model' ? thinkingConfig : undefined,
          thinkingMode,
          customApiFormat,
          retryConfig,
          nativeToolCall,
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

          // Mark pending update and ensure interval is running
          this.pendingContentUpdate = true;
          startUpdateInterval();
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

          // Mark pending update and ensure interval is running
          this.pendingContentUpdate = true;
          startUpdateInterval();
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

          // Mark pending update and ensure interval is running
          this.pendingContentUpdate = true;
          startUpdateInterval();
        }

        // Handle tool calls (interval-throttled for smooth updates)
        if (chunk.tool_calls && this.toolTracker) {
          const progressEvents = this.toolTracker.applyDelta(chunk.tool_calls);
          if (progressEvents.length && this.callbacks.onToolCallProgress) {
            this.pendingProgress = progressEvents;
            this.pendingProgressUpdate = true;
            startUpdateInterval();
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

      // 8. Finalize - stop interval and flush pending updates
      if (this.updateIntervalId !== null) {
        clearInterval(this.updateIntervalId);
        this.updateIntervalId = null;
      }

      // Flush any pending progress updates
      if (this.pendingProgress && this.callbacks.onToolCallProgress) {
        this.callbacks.onToolCallProgress(this.pendingProgress);
        this.pendingProgress = null;
      }

      finalizeCurrentBuffer();

      // Final update
      this.callbacks.onUpdate([...this.pendingParts]);

      // 9. Complete with results
      const rawToolCalls = this.toolTracker?.finalize() ?? [];
      const toolCalls: ToolCallMetadata[] = rawToolCalls.map((fc: any) => ({
        id: fc.id,
        tool_name: fc.function?.name ?? '',
        arguments: this.parseArguments(fc.function?.arguments),
        status: 'pending',
      }));

      // Log streaming completion
      console.log('✅ LLM Streaming Complete:', {
        success: true,
        contentParts: [...this.pendingParts],
        toolCallCount: toolCalls.length,
        toolCalls,
      });

      // Update log entry to success
      if (logEntryId) {
        logStore.updateLogEntry(logEntryId, {
          status: 'success',
          durationMs: Date.now() - requestStartTime,
          response: {
            contentParts: [...this.pendingParts],
            toolCalls,
            thinkingDetails: accumulatedThinkingDetails,
          },
        });
      }

      return {
        contentParts: [...this.pendingParts],
        toolCalls,
        thinkingDetails: accumulatedThinkingDetails,
        usage: capturedUsage,
        provider,
        model,
      };
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

      throw err;
    } finally {
      if (this.updateIntervalId !== null) {
        clearInterval(this.updateIntervalId);
        this.updateIntervalId = null;
      }
      this.pendingContentUpdate = false;
      this.pendingProgressUpdate = false;
      this.isRunning = false;
    }
  }

  /**
   * Abort the running task
   */
  abort(): void {
    this.config.abortController.abort();
    if (this.updateIntervalId !== null) {
      clearInterval(this.updateIntervalId);
      this.updateIntervalId = null;
    }
    this.pendingContentUpdate = false;
    this.pendingProgressUpdate = false;
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
    const fcLimit = settings.toolCallHistoryLimit;
    const thinkingLimit = settings.thinkingHistoryLimit;

    // 1. System prompt
    messages.push({
      role: 'system',
      contentParts: [{ type: 'content', text: promptBundle.systemPrompt }],
    });

    // 2. Count assistant messages to determine which ones should include tool calls
    // (we include tool calls from the last N assistant messages)
    const assistantIndices: number[] = [];
    for (let i = 0; i < history.length; i++) {
      if (history[i].role === 'assistant') {
        assistantIndices.push(i);
      }
    }
    const totalAssistants = assistantIndices.length;

    // Find all user message indices for position-based template selection
    const userIndices: number[] = [];
    for (let i = 0; i < history.length; i++) {
      if (history[i].role === 'user') userIndices.push(i);
    }
    const totalUsers = userIndices.length;
    const firstUserIndex = userIndices[0] ?? -1;
    const lastUserIndex = userIndices[userIndices.length - 1] ?? -1;
    const isSingleUser = totalUsers === 1;

    // 3. Process history (all previous messages - AgentManager passes history without current user message)
    let assistantCount = 0;
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];

      if (msg.role === 'user') {
        // Position-based template selection
        let template: string;
        if (isSingleUser) {
          template = promptBundle.initialUserPrompt ?? promptBundle.lastUserPrompt ?? promptBundle.firstUserPrompt ?? promptBundle.userPrompt;
        } else if (i === firstUserIndex) {
          template = promptBundle.firstUserPrompt ?? promptBundle.userPrompt;
        } else if (i === lastUserIndex) {
          template = promptBundle.lastUserPrompt ?? promptBundle.userPrompt;
        } else {
          template = promptBundle.userPrompt;
        }

        const rendered = PromptManager.renderTemplate(template, {
          ...promptBundle.templateData,
          input: { userMessage: this.getMessageText(msg) },
        });
        messages.push({
          role: 'user',
          contentParts: [{ type: 'content', text: rendered }],
        });
      } else if (msg.role === 'assistant') {
        // For assistant messages, potentially include tool_calls and thinking
        assistantCount++;

        // Determine if we should include tool calls for this message
        // fcLimit: 0 = none, -1 = all, N = last N assistant messages
        const shouldIncludeFC = fcLimit === -1 ||
          (fcLimit > 0 && assistantCount > totalAssistants - fcLimit);

        // Determine if we should include thinking for this message
        // thinkingLimit: 0 = none, -1 = all, N = last N assistant messages
        const shouldIncludeThinking = thinkingLimit === -1 ||
          (thinkingLimit > 0 && assistantCount > totalAssistants - thinkingLimit);

        // Filter contentParts: remove thinking if not included
        const filteredContentParts = shouldIncludeThinking
          ? msg.contentParts
          : msg.contentParts.filter(part => part.type !== 'thinking');

        const block: ConversationBlock = {
          role: msg.role,
          contentParts: filteredContentParts.length > 0
            ? filteredContentParts
            : [{ type: 'content', text: '' }],
        };

        // Add tool_calls if applicable
        if (shouldIncludeFC && msg.toolCalls && msg.toolCalls.length > 0) {
          block.tool_calls = msg.toolCalls.map(fc => ({
            id: fc.id,
            type: 'function' as const,
            function: {
              name: fc.tool_name,
              arguments: typeof fc.arguments === 'string'
                ? fc.arguments
                : JSON.stringify(fc.arguments),
            },
          }));
        }

        messages.push(block);

        // Add tool_results message if this assistant message had tool_calls with results
        if (block.tool_calls && block.tool_calls.length > 0 && msg.toolCalls) {
          const toolResults = msg.toolCalls
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
                tool_name: fc.tool_name,
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

    // 4. Prefill (if configured)
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
   * Parse tool call arguments from JSON string to object
   */
  private parseArguments(args: string | undefined): any {
    if (!args) return {};
    try {
      return JSON.parse(args);
    } catch {
      console.error('Failed to parse tool call arguments:', args);
      return {};
    }
  }
}

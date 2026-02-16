import type {
  ChatMessage,
  ContentPart,
  ContentPartType,
  ToolCallMetadata,
  ToolCallProgress,
} from './requestTypes';
import type { FinalSnapshot } from './streamProtocol';
import { BackendError, streamLLM } from './llmService';
import { useSettingsStore, type AITaskType } from '../store/settingsStore';
import { useLLMLogStore } from '../store/llmLogStore';
import { ToolCallStreamTracker } from '../agent/streaming/ToolCallStreamTracker';
import { PromptManager } from './PromptManager';
import type {
  LLMTaskConfig,
  LLMTaskCallbacks,
  LLMTaskResult,
  OutputMode,
  LLMTaskModeType,
} from './types';
import { LLMTaskMode } from './types';
import { buildConversationBlocks } from './conversation/buildConversationBlocks';

const MODE_TO_TASK_TYPE: Record<LLMTaskModeType, AITaskType> = {
  [LLMTaskMode.AGENT_PLAN_MODE]: 'agent',
  [LLMTaskMode.AGENT_AGENT_MODE]: 'agent',
  [LLMTaskMode.AGENT_MEMORY_SUMMARY]: 'summary',
  [LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT]: 'editAssistant',
  [LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT]: 'editAssistant',
  [LLMTaskMode.TRANSLATION]: 'translation',
  [LLMTaskMode.AGENT_TRANSLATION]: 'translation',
  [LLMTaskMode.OBJECT_IMAGE_PROMPT]: 'imagePrompt',
  [LLMTaskMode.SCENE_IMAGE_PROMPT]: 'imagePrompt',
  [LLMTaskMode.COVER_IMAGE_PROMPT]: 'imagePrompt',
  [LLMTaskMode.SUB_AGENT]: 'subAgent',
};

export class LLMTask {
  private readonly config: LLMTaskConfig;
  private readonly callbacks: LLMTaskCallbacks;
  private pendingParts: ContentPart[] = [];
  private isRunning = false;
  private toolTracker: ToolCallStreamTracker | null = null;
  private pendingProgress: ToolCallProgress[] | null = null;

  private updateIntervalId: number | null = null;
  private pendingContentUpdate = false;
  private pendingProgressUpdate = false;
  private readonly UPDATE_INTERVAL_MS = 50;

  constructor(config: LLMTaskConfig, callbacks: LLMTaskCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  async run(history: ChatMessage[] = []): Promise<LLMTaskResult> {
    if (this.isRunning) {
      console.warn('LLMTask: Already running');
      throw new Error('LLMTask: Already running');
    }

    this.isRunning = true;
    this.pendingParts = [];

    const logStore = useLLMLogStore.getState();
    const settingsStore = useSettingsStore.getState();
    const isLoggingEnabled = settingsStore.getSettings().llmLoggingEnabled;
    let logEntryId: string | undefined;
    const requestStartTime = Date.now();

    try {
      const settings = settingsStore.getSettings();

      const taskType = MODE_TO_TASK_TYPE[this.config.mode];
      const taskConfig = settings.task_configs[taskType];

      const provider = this.config.provider ?? taskConfig.provider;
      const model = this.config.model ?? taskConfig.model;
      const temperature = this.config.temperature ?? taskConfig.temperature;
      const max_tokens = taskConfig.max_output_tokens;
      const thinking_mode = this.config.thinking_mode ?? taskConfig.advanced.thinking_mode;
      const thinking_config = this.config.thinking_config ?? taskConfig.advanced.thinking_config;
      const thinking_format = this.config.thinking_format ?? taskConfig.advanced.thinking_format;
      const request_format = this.config.request_format ?? taskConfig.advanced.request_format;
      const effective_thinking_format =
        provider === 'custom' && request_format === 'openai_sdk'
          ? thinking_format
          : undefined;
      const retryConfig = this.config.retryConfig ?? settings.retryConfig;

      const promptBundle = await PromptManager.generatePromptBundle(
        this.config.mode,
        this.config.promptContext,
      );

      const tools = PromptManager.getToolsForMode(
        this.config.mode,
        this.config.promptContext,
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

      const messages = buildConversationBlocks(history, promptBundle, {
        toolCallHistoryLimit: settings.toolCallHistoryLimit,
        thinkingHistoryLimit: settings.thinkingHistoryLimit,
        includePrefill: true,
      });

      const nativeToolCall = outputMode === 'native_tool_call';
      const effectiveToolChoice = outputMode === 'tool_call' ? this.config.tool_choice : undefined;

      if (outputMode !== 'tool_call' && tools?.length) {
        throw new Error(`${outputMode} requires tools to be omitted`);
      }

      console.log('LLM Request:', {
        mode: this.config.mode,
        provider,
        model,
        temperature,
        thinking_mode,
        outputMode,
        tools,
        messages,
      });

      if (isLoggingEnabled) {
        logEntryId = logStore.addLogEntry({
          status: 'pending',
          request: {
            mode: this.config.mode,
            provider,
            model,
            temperature,
            thinking_mode,
            outputMode,
            tools,
            messages,
          },
        });
      }

      this.toolTracker = new ToolCallStreamTracker();

      let currentPartType: ContentPartType | null = null;
      let currentBuffer = '';
      let accumulatedThinkingDetails: any[] | undefined;
      let finalSnapshot: FinalSnapshot | null = null;
      let doneSeen = false;

      const finalizeCurrentBuffer = () => {
        if (currentPartType && currentBuffer) {
          this.pendingParts.push({ type: currentPartType, text: currentBuffer });
          currentBuffer = '';
          currentPartType = null;
        }
      };

      const appendTextDelta = (partType: ContentPartType, rawText: string) => {
        const isTypeSwitch = currentPartType !== partType;
        const textToAdd = isTypeSwitch ? rawText.trimStart() : rawText;

        if (isTypeSwitch) {
          finalizeCurrentBuffer();
          const lastPart = this.pendingParts[this.pendingParts.length - 1];
          if (lastPart && lastPart.type === partType) {
            this.pendingParts.pop();
            currentBuffer = lastPart.text;
          }
          currentPartType = partType;
        }

        currentBuffer += textToAdd;
        this.pendingContentUpdate = true;
      };

      const startUpdateInterval = () => {
        if (this.updateIntervalId === null) {
          this.updateIntervalId = window.setInterval(() => {
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

            if (this.pendingProgressUpdate && this.pendingProgress) {
              this.pendingProgressUpdate = false;
              if (this.callbacks.onToolCallProgress) {
                this.callbacks.onToolCallProgress(this.pendingProgress);
              }
            }
          }, this.UPDATE_INTERVAL_MS);
        }
      };

      if (logEntryId) {
        logStore.updateLogEntry(logEntryId, { status: 'streaming' });
      }

      for await (const event of streamLLM(
        messages,
        provider,
        {
          signal: this.config.abortController.signal,
          tools,
          model,
          temperature,
          max_tokens,
          thinking_config: thinking_mode === 'model' ? thinking_config : undefined,
          thinking_mode,
          thinking_format: effective_thinking_format,
          request_format,
          retryConfig,
          native_tool_call: nativeToolCall,
          tool_choice: effectiveToolChoice,
        },
      )) {
        if (event.type === 'delta') {
          if (event.contentDelta) {
            appendTextDelta('content', event.contentDelta);
            startUpdateInterval();
          }

          if (event.thinkingDelta) {
            appendTextDelta('thinking', event.thinkingDelta);
            startUpdateInterval();
          }

          if (event.toolCallDeltas.length && this.toolTracker) {
            const progressEvents = this.toolTracker.applyDelta(event.toolCallDeltas as any);
            if (progressEvents.length && this.callbacks.onToolCallProgress) {
              this.pendingProgress = progressEvents;
              this.pendingProgressUpdate = true;
              startUpdateInterval();
            }
          }

          if (event.thinkingDetailsDelta.length) {
            if (!accumulatedThinkingDetails) {
              accumulatedThinkingDetails = [];
            }
            accumulatedThinkingDetails.push(...event.thinkingDetailsDelta);
          }

          continue;
        }

        if (event.type === 'final') {
          if (finalSnapshot) {
            throw new Error('Protocol violation: final event was emitted more than once');
          }
          finalSnapshot = event.snapshot;
          continue;
        }

        if (event.type === 'error') {
          throw new BackendError(`Backend Error: ${event.message}`, event.status ?? null);
        }

        if (event.type === 'done') {
          doneSeen = true;
          if (!event.ok) {
            throw new Error('Stream completed with done(ok=false)');
          }
          break;
        }
      }

      if (!doneSeen) {
        throw new Error('Stream ended without done event');
      }

      if (!finalSnapshot) {
        throw new Error('Protocol violation: done received without final snapshot');
      }

      if (this.updateIntervalId !== null) {
        clearInterval(this.updateIntervalId);
        this.updateIntervalId = null;
      }

      if (this.pendingProgress && this.callbacks.onToolCallProgress) {
        this.callbacks.onToolCallProgress(this.pendingProgress);
        this.pendingProgress = null;
      }

      finalizeCurrentBuffer();

      const normalizedContentParts: ContentPart[] = Array.isArray(finalSnapshot.contentParts)
        ? finalSnapshot.contentParts
            .filter((part): part is ContentPart => (
              Boolean(part) &&
              (part.type === 'content' || part.type === 'thinking') &&
              typeof part.text === 'string'
            ))
            .map((part) => ({ type: part.type, text: part.text }))
        : [];

      this.pendingParts = normalizedContentParts;
      this.callbacks.onUpdate([...this.pendingParts]);

      const toolCalls: ToolCallMetadata[] = Array.isArray(finalSnapshot.toolCalls)
        ? finalSnapshot.toolCalls.map((fc: any) => ({
            id: fc.id,
            tool_name: fc.tool_name ?? '',
            arguments: (fc.arguments && typeof fc.arguments === 'object') ? fc.arguments : {},
            extra_content: fc.extra_content,
            status: 'pending',
          }))
        : [];

      const snapshotThinkingDetails = Array.isArray(finalSnapshot.thinkingDetails)
        ? finalSnapshot.thinkingDetails
        : accumulatedThinkingDetails;

      console.log('✅ LLM Streaming Complete:', {
        success: true,
        contentParts: [...this.pendingParts],
        toolCallCount: toolCalls.length,
        toolCalls,
        finalSource: finalSnapshot.finalSource,
      });

      if (logEntryId) {
        logStore.updateLogEntry(logEntryId, {
          status: 'success',
          durationMs: Date.now() - requestStartTime,
          response: {
            contentParts: [...this.pendingParts],
            toolCalls,
            thinkingDetails: snapshotThinkingDetails,
          },
        });
      }

      return {
        contentParts: [...this.pendingParts],
        toolCalls,
        thinkingDetails: snapshotThinkingDetails,
        usage: finalSnapshot.usage ?? undefined,
        provider,
        model: finalSnapshot.model || model,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      console.log('LLM Streaming Failed:', {
        success: false,
        error: err.message,
        contentParts: [...this.pendingParts],
      });

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
}

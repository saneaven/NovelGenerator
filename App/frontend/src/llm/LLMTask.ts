import type {
  ChatMessage,
  ContentPart,
  ContentPartType,
  ConversationBlock,
  FunctionCallMetadata,
} from './requestTypes';
import { streamLLM } from './llmService';
import { useSettingsStore, type AIFunctionType } from '../store/settingsStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { useLLMLogStore } from '../store/llmLogStore';
import { FunctionCallStreamTracker } from '../chat/streaming/FunctionCallStreamTracker';
import { PromptManager } from './PromptManager';
import type {
  LLMTaskConfig,
  LLMTaskCallbacks,
  LLMTaskResult,
  PromptBundle,
  LLMTaskModeType,
} from './types';
import { LLMTaskMode } from './types';

/**
 * Map LLMTaskMode to AIFunctionType for settings lookup
 */
const MODE_TO_FUNCTION_TYPE: Record<LLMTaskModeType, AIFunctionType> = {
  [LLMTaskMode.CHAT_WORKSPACE]: 'chat',
  [LLMTaskMode.CHAT_NOVEL_EDITOR]: 'chat',
  [LLMTaskMode.STORY_OBJECT_EDIT]: 'storyObjectEdit',
  [LLMTaskMode.CHAPTER_EDIT]: 'chapterGen',
  [LLMTaskMode.TRANSLATION]: 'translation',
  [LLMTaskMode.CHAT_TRANSLATION]: 'translation',
  [LLMTaskMode.OBJECT_IMAGE_PROMPT]: 'imagePrompt',
  [LLMTaskMode.SCENE_IMAGE_PROMPT]: 'imagePrompt',
};

/**
 * LLMTask - Core streaming class with RAF throttling
 *
 * Responsibilities:
 * - Message preparation (template rendering via PromptManager)
 * - Stream LLM response via streamChat()
 * - Content part accumulation (thinking, content)
 * - RAF-throttled updates (callback + llmTaskStore)
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

  constructor(config: LLMTaskConfig, callbacks: LLMTaskCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  /**
   * Run the LLM task with the given chat history
   * @param history - Optional chat history (ChatManager passes this, modals don't)
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
    let logEntryId: string | undefined;
    const requestStartTime = Date.now();

    try {
      // 1. Get provider/model config (from settings or overrides)
      const settingsStore = useSettingsStore.getState();
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

      // 4. Prepare messages
      const messages = await this.prepareMessages(history, promptBundle);

      // Log LLM request structure for debugging
      console.log('LLM Request:', {
        mode: this.config.mode,
        provider,
        model,
        temperature,
        thinkingMode,
        functions,
        messages,
      });

      // Log to LLM Log Store if enabled
      if (logStore.isLoggingEnabled) {
        logEntryId = logStore.addLogEntry({
          status: 'pending',
          request: {
            mode: this.config.mode,
            provider,
            model,
            temperature,
            thinkingMode,
            functions,
            messages,
          },
        });
      }

      // 5. Initialize function tracker
      this.functionTracker = new FunctionCallStreamTracker(functions);

      // 6. Setup abort controller
      this.config.abortControllerRef.current = new AbortController();

      // 7. Stream with RAF throttling
      let currentPartType: ContentPartType | null = null;
      let currentBuffer = '';
      let accumulatedThinkingDetails: any[] | undefined;

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
          signal: this.config.abortControllerRef.current.signal,
          functions,
          model,
          temperature,
          thinkingConfig: thinkingMode === 'model' ? thinkingConfig : undefined,
          thinkingMode,
          retryConfig,
        }
      )) {
        // Handle string chunk (content)
        if (typeof chunk === 'string') {
          if (currentPartType !== 'content') {
            finalizeCurrentBuffer();
            // Merge with last content part if exists
            const lastPart = this.pendingParts[this.pendingParts.length - 1];
            if (lastPart && lastPart.type === 'content') {
              this.pendingParts.pop();
              currentBuffer = lastPart.text;
            }
            currentPartType = 'content';
          }
          currentBuffer += chunk;

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
              if (this.config.sessionId) {
                useLLMTaskStore.getState().setContentParts(this.config.sessionId, [
                  ...this.pendingParts,
                  { type: 'content', text: currentBuffer },
                ]);
              }
            });
          }
          continue;
        }

        // Handle thinking chunk
        const thinkingText = (chunk as any).thinking_text;
        if (thinkingText) {
          if (currentPartType !== 'thinking') {
            finalizeCurrentBuffer();
            const lastPart = this.pendingParts[this.pendingParts.length - 1];
            if (lastPart && lastPart.type === 'thinking') {
              this.pendingParts.pop();
              currentBuffer = lastPart.text;
            }
            currentPartType = 'thinking';
          }
          currentBuffer += thinkingText;

          if (this.rafId === null) {
            this.rafId = requestAnimationFrame(() => {
              this.rafId = null;
              this.callbacks.onUpdate([
                ...this.pendingParts,
                { type: 'thinking', text: currentBuffer },
              ]);
              if (this.config.sessionId) {
                useLLMTaskStore.getState().setContentParts(this.config.sessionId, [
                  ...this.pendingParts,
                  { type: 'thinking', text: currentBuffer },
                ]);
              }
            });
          }
        }

        // Handle content in object form
        if (chunk.content) {
          if (currentPartType !== 'content') {
            finalizeCurrentBuffer();
            const lastPart = this.pendingParts[this.pendingParts.length - 1];
            if (lastPart && lastPart.type === 'content') {
              this.pendingParts.pop();
              currentBuffer = lastPart.text;
            }
            currentPartType = 'content';
          }
          currentBuffer += chunk.content;

          if (this.rafId === null) {
            this.rafId = requestAnimationFrame(() => {
              this.rafId = null;
              this.callbacks.onUpdate([
                ...this.pendingParts,
                { type: 'content', text: currentBuffer },
              ]);
              if (this.config.sessionId) {
                useLLMTaskStore.getState().setContentParts(this.config.sessionId, [
                  ...this.pendingParts,
                  { type: 'content', text: currentBuffer },
                ]);
              }
            });
          }
        }

        // Handle tool calls
        if (chunk.tool_calls && this.functionTracker) {
          const progressEvents = this.functionTracker.applyDelta(chunk.tool_calls);
          if (progressEvents.length && this.callbacks.onFunctionProgress) {
            this.callbacks.onFunctionProgress(progressEvents);
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
      }

      // 8. Finalize
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }

      finalizeCurrentBuffer();

      // Final update
      this.callbacks.onUpdate([...this.pendingParts]);
      if (this.config.sessionId) {
        useLLMTaskStore.getState().setContentParts(this.config.sessionId, [...this.pendingParts]);
      }

      // 9. Complete with results
      const rawFunctionCalls = this.functionTracker?.finalize() ?? [];
      const functionCalls: FunctionCallMetadata[] = rawFunctionCalls.map((fc: any) => ({
        id: fc.id,
        function_name: fc.function?.name ?? '',
        arguments: this.parseArguments(fc.function?.arguments),
        isApplied: false,
        isRejected: false,
      }));
      const result: LLMTaskResult = {
        contentParts: [...this.pendingParts],
        functionCalls,
        thinkingDetails: accumulatedThinkingDetails,
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
      if (this.config.abortControllerRef.current) {
        this.config.abortControllerRef.current = null;
      }
    }
  }

  /**
   * Abort the running task
   */
  abort(): void {
    if (this.config.abortControllerRef.current) {
      this.config.abortControllerRef.current.abort();
      this.config.abortControllerRef.current = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
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

    // 1. System prompt
    messages.push({
      role: 'system',
      contentParts: [{ type: 'content', text: promptBundle.systemPrompt }],
    });

    // 2. Process history (all previous messages - ChatManager passes history without current user message)
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];

      if (msg.role === 'user' && promptBundle.nonLastUserPrompt) {
        // Render non-last user message with template, inheriting all templateData but overriding userInput
        const rendered = PromptManager.renderTemplate(promptBundle.nonLastUserPrompt, {
          ...promptBundle.templateData,
          variable: {
            ...promptBundle.templateData.variable,
            userInput: this.getMessageText(msg),
          },
        });
        messages.push({
          role: 'user',
          contentParts: [{ type: 'content', text: rendered }],
        });
      } else {
        // Use raw message content
        messages.push({
          role: msg.role,
          contentParts: msg.contentParts.length > 0
            ? msg.contentParts
            : [{ type: 'content', text: '' }],
        });
      }
    }

    // 3. Last user message (rendered from userPrompt template with userRequest)
    messages.push({
      role: 'user',
      contentParts: [{ type: 'content', text: promptBundle.userPrompt }],
    });

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

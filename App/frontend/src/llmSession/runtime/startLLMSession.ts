import type { ChatMessage, ContentPart, ToolCallProgress, ToolCallMetadata } from '../../llm/requestTypes';
import type { LLMTaskModeType, PromptContext } from '../../llm/types';
import type { ProviderType, ProviderConfig, ThinkingConfig, CustomApiFormat, RetryConfig } from '../../store/settingsStore';
import { LLMTask } from '../../llm/LLMTask';
import { BackendError } from '../../llm/llmService';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { generateTempId } from '../../utils/tempId';
import type { TaskKind, TaskSessionState } from '../../llmTask/types';

export interface LLMRunConfig {
  mode: LLMTaskModeType;
  projectId: string;
  promptContext: PromptContext;

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

export type StartLLMSessionInput<TInput = unknown> = LLMRunConfig & {
  kind: TaskKind;
  label: string;
  input: TInput;
  history?: ChatMessage[];
};

export type LLMSessionHandle<TResult = unknown> = {
  sessionId: string;
  abort: () => void;
  done: Promise<TaskSessionState<any, TResult>>;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatLLMSessionError(error: unknown): string {
  if (error instanceof BackendError) {
    const statusCode = error.statusCode;
    if (statusCode === null || statusCode === undefined) {
      return error.message;
    }

    // Keep existing formatted errors intact
    if (error.message.startsWith('Backend Error (')) {
      return error.message;
    }

    // Upgrade "Backend Error: ..." -> "Backend Error (CODE): ..."
    if (error.message.startsWith('Backend Error:')) {
      const suffix = error.message.slice('Backend Error:'.length).trimStart();
      return `Backend Error (${statusCode}): ${suffix}`;
    }

    return `Backend Error (${statusCode}): ${error.message}`;
  }

  return error instanceof Error ? error.message : String(error);
}

export function startLLMSession<TInput = unknown, TResult = unknown>(
  input: StartLLMSessionInput<TInput>
): LLMSessionHandle<TResult> {
  const sessionId = `llm-${generateTempId()}`;
  const abortController = new AbortController();
  const store = useLLMSessionStore.getState();
  const now = Date.now();

  const availableToolNames = Array.isArray((input.promptContext as any)?.tools)
    ? ((input.promptContext as any).tools as Array<{ name?: unknown }>)
        .map((t) => (typeof t?.name === 'string' ? t.name : null))
        .filter((n): n is string => Boolean(n && n.trim()))
    : undefined;

  // Create session immediately so UI can subscribe
  store.createSession({
    id: sessionId,
    kind: input.kind,
    input: input.input,
    status: 'running',
    label: input.label,
    createdAt: now,
    updatedAt: now,
    contentParts: [],
    toolCallProgress: [],
    toolCalls: [],
    availableToolNames,
  } as any);

  // Register abort immediately so Stop works right away
  store.registerAbortController(sessionId, abortController);

  const done = (async () => {
    try {
      const task = new LLMTask(
        {
          mode: input.mode,
          projectId: input.projectId,
          promptContext: input.promptContext,
          abortController,
          provider: input.provider,
          providerConfig: input.providerConfig,
          model: input.model,
          temperature: input.temperature,
          thinkingMode: input.thinkingMode,
          thinkingConfig: input.thinkingConfig,
          customApiFormat: input.customApiFormat,
          retryConfig: input.retryConfig,
          sessionId,
        },
        {
          onUpdate: (parts: ContentPart[]) => {
            store.setContentParts(sessionId, parts);
          },
          onToolCallProgress: (progress: ToolCallProgress[]) => {
            // Merge progress updates so multiple calls can stream concurrently
            store.updateSession(sessionId, { toolCallProgress: progress } as any);
          },
        }
      );

      const result = await task.run(input.history ?? []);

      store.updateSession(sessionId, {
        status: 'success',
        contentParts: result.contentParts,
        toolCalls: result.toolCalls as ToolCallMetadata[],
        thinkingDetails: result.thinkingDetails,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        warning: result.warning,
      } as any);
    } catch (error) {
      const existing = store.getSessionById(sessionId);
      if (existing?.status === 'cancelled') {
        return existing as any;
      }

      if (isAbortError(error) || abortController.signal.aborted) {
        store.updateSession(sessionId, { status: 'cancelled' } as any);
      } else {
        const message = formatLLMSessionError(error);
        store.updateSession(sessionId, { status: 'error', error: message } as any);
      }
    } finally {
      store.unregisterAbortController(sessionId);
    }

    return store.getSessionById(sessionId)! as any;
  })();

  return {
    sessionId,
    abort: () => store.cancelSession(sessionId),
    done,
  };
}

import type { ChatMessage, ContentPart, FunctionCallProgress, FunctionCallMetadata } from '../../llm/requestTypes';
import type { LLMTaskModeType, PromptContext } from '../../llm/types';
import type { ProviderType, ProviderConfig, ThinkingConfig, CustomApiFormat, RetryConfig } from '../../store/settingsStore';
import { LLMTask } from '../../llm/LLMTask';
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

export function startLLMSession<TInput = unknown, TResult = unknown>(
  input: StartLLMSessionInput<TInput>
): LLMSessionHandle<TResult> {
  const sessionId = `llm-${generateTempId()}`;
  const abortController = new AbortController();
  const store = useLLMSessionStore.getState();
  const now = Date.now();

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
    functionCallProgress: [],
    functionCalls: [],
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
          onFunctionProgress: (progress: FunctionCallProgress[]) => {
            // Merge progress updates so multiple calls can stream concurrently
            store.updateSession(sessionId, { functionCallProgress: progress } as any);
          },
        }
      );

      const result = await task.run(input.history ?? []);

      store.updateSession(sessionId, {
        status: 'success',
        contentParts: result.contentParts,
        functionCalls: result.functionCalls as FunctionCallMetadata[],
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
        const message = error instanceof Error ? error.message : String(error);
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

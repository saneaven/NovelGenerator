import { useLLMTaskStore } from '../store/llmTaskStore';
import { generateTempId } from '../utils/tempId';
import type { TaskKind, TaskSessionState } from './types';
import { getTaskSpec } from './specs/specRegistry';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export const TaskRuntime = {
  start<TInput>(kind: TaskKind, input: TInput): string {
    const sessionId = `llm-task-${generateTempId()}`;
    const store = useLLMTaskStore.getState();

    const spec = getTaskSpec(kind) as any;
    const label = spec.label(input);

    const now = Date.now();
    const session: TaskSessionState<TInput, unknown> = {
      id: sessionId,
      kind,
      input,
      label,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      isRead: false,
      contentParts: [],
      functionCallProgress: [],
    };

    store.createSession(session as any);

    const abortController = new AbortController();
    store.registerAbortController(sessionId, abortController);

    void (async () => {
      const updateSession = (partial: Partial<Omit<TaskSessionState<TInput, unknown>, 'id' | 'kind' | 'input'>>) => {
        store.updateSession(sessionId, partial as any);
      };

      const setSessionStatus = (status: TaskSessionState['status']) => {
        store.updateSession(sessionId, { status } as any);
      };

      try {
        const result = await spec.run({
          sessionId,
          input,
          abortController,
          updateSession,
          setSessionStatus,
        });

        if (result !== undefined) {
          store.updateSession(sessionId, { result } as any);
        }

        const final = store.getSessionById(sessionId);
        if (final && final.status === 'running') {
          store.updateSession(sessionId, { status: 'success' } as any);
        }
      } catch (error) {
        if (isAbortError(error)) {
          store.updateSession(sessionId, { status: 'cancelled' } as any);
        } else {
          const message = error instanceof Error ? error.message : String(error);
          store.updateSession(sessionId, { status: 'error', error: message } as any);
        }
      } finally {
        store.unregisterAbortController(sessionId);
      }
    })();

    return sessionId;
  },

  retry(sessionId: string): string {
    const store = useLLMTaskStore.getState();
    const session = store.getSessionById(sessionId) as TaskSessionState | undefined;
    if (!session) {
      throw new Error(`Cannot retry; session not found: ${sessionId}`);
    }
    return this.start(session.kind, session.input);
  },
};

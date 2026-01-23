import { create } from 'zustand';
import type { ContentPart, ToolCallProgress } from '../llm/requestTypes';
import type { TaskSessionState } from '../llmTask';

// AbortController registry (outside Zustand store to avoid serialization issues)
const abortControllers = new Map<string, AbortController>();

type AnySession = TaskSessionState<any, any>;

function getProgressKey(progress: ToolCallProgress): string {
  const index = progress?.draft?.index;
  if (typeof index === 'number') {
    return `index:${index}`;
  }
  return `id:${progress?.draft?.id ?? ''}`;
}

function mergeToolCallProgress(
  existing: ToolCallProgress[] | undefined,
  incoming: ToolCallProgress[]
): ToolCallProgress[] {
  // Explicit empty array means "clear"
  if (incoming.length === 0) {
    return [];
  }

  const order: string[] = [];
  const map = new Map<string, ToolCallProgress>();

  for (const p of existing ?? []) {
    const key = getProgressKey(p);
    if (!map.has(key)) {
      order.push(key);
    }
    map.set(key, p);
  }

  for (const p of incoming) {
    const key = getProgressKey(p);
    if (!map.has(key)) {
      order.push(key);
    }
    map.set(key, p);
  }

  return order.map((key) => map.get(key)!).filter(Boolean);
}

interface LLMSessionStore {
  sessions: Record<string, AnySession | undefined>;

  // Core session management
  createSession: (session: AnySession) => void;
  updateSession: (id: string, partial: Partial<Omit<AnySession, 'id' | 'kind' | 'input'>>) => void;
  setContentParts: (id: string, contentParts: ContentPart[]) => void;
  clearSession: (id: string) => void;

  // Query helpers
  getActiveSessions: () => AnySession[];
  getSessionById: (id: string) => AnySession | undefined;
  hasRunningSessions: () => boolean;

  // Abort controller management
  registerAbortController: (id: string, controller: AbortController) => void;
  unregisterAbortController: (id: string) => void;
  cancelSession: (id: string) => void;
}

export const useLLMSessionStore = create<LLMSessionStore>((set, get) => ({
  sessions: {},

  createSession: (session) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [session.id]: session,
      },
    })),

  updateSession: (id, partial) =>
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;

      const mergedProgress =
        partial.toolCallProgress !== undefined
          ? mergeToolCallProgress(existing.toolCallProgress, partial.toolCallProgress)
          : existing.toolCallProgress;

      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            ...partial,
            toolCallProgress: mergedProgress,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  setContentParts: (id, contentParts) =>
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            contentParts,
            updatedAt: Date.now(),
          },
        },
      };
    }),

  clearSession: (id) =>
    set((state) => {
      if (!state.sessions[id]) {
        return state;
      }
      const next = { ...state.sessions };
      delete next[id];
      return { sessions: next };
    }),

  // Query helpers
  getActiveSessions: () => {
    const { sessions } = get();
    return Object.values(sessions)
      .filter((s): s is AnySession => s !== undefined && s.status !== 'idle')
      .sort((a, b) => b.createdAt - a.createdAt);
  },

  getSessionById: (id) => get().sessions[id],

  hasRunningSessions: () => {
    const { sessions } = get();
    return Object.values(sessions).some(
      (s) => s !== undefined && s.status === 'running'
    );
  },

  // Abort controller management
  registerAbortController: (id, controller) => {
    abortControllers.set(id, controller);
  },

  unregisterAbortController: (id) => {
    abortControllers.delete(id);
  },

  cancelSession: (id) => {
    // 1) Abort the request
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }

    // 2) Update status to cancelled
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            status: 'cancelled',
            updatedAt: Date.now(),
          },
        },
      };
    });
  },
}));

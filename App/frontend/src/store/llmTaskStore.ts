import { create } from 'zustand';
import type { ContentPart, FunctionCallProgress } from '../llm/requestTypes';
import type { TaskSessionState } from '../llmTask';

// AbortController registry (outside Zustand store to avoid serialization issues)
const abortControllers = new Map<string, AbortController>();

type AnySession = TaskSessionState<any, any>;

function getProgressKey(progress: FunctionCallProgress): string {
  const index = progress?.draft?.index;
  if (typeof index === 'number') {
    return `index:${index}`;
  }
  return `id:${progress?.draft?.id ?? ''}`;
}

function mergeFunctionCallProgress(
  existing: FunctionCallProgress[] | undefined,
  incoming: FunctionCallProgress[]
): FunctionCallProgress[] {
  // Explicit empty array means "clear"
  if (incoming.length === 0) {
    return [];
  }

  const order: string[] = [];
  const map = new Map<string, FunctionCallProgress>();

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

interface LLMTaskStore {
  sessions: Record<string, AnySession | undefined>;

  // Core session management
  createSession: (session: AnySession) => void;
  updateSession: (id: string, partial: Partial<Omit<AnySession, 'id' | 'kind' | 'input'>>) => void;
  setContentParts: (id: string, contentParts: ContentPart[]) => void;
  setFunctionCallProgress: (id: string, progress: FunctionCallProgress[]) => void;
  clearSession: (id: string) => void;

  // Query helpers
  getActiveSessions: () => AnySession[];
  getSessionById: (id: string) => AnySession | undefined;
  hasUnread: () => boolean;
  hasRunningTasks: () => boolean;

  // Notification actions
  markAllAsRead: () => void;
  clearNotification: (id: string) => void;
  clearAllNotifications: () => void;

  // Abort controller management
  registerAbortController: (id: string, controller: AbortController) => void;
  unregisterAbortController: (id: string) => void;
  cancelTask: (id: string) => void;
}

export const useLLMTaskStore = create<LLMTaskStore>((set, get) => ({
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
        partial.functionCallProgress !== undefined
          ? mergeFunctionCallProgress(existing.functionCallProgress, partial.functionCallProgress)
          : existing.functionCallProgress;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            ...partial,
            functionCallProgress: mergedProgress,
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
  setFunctionCallProgress: (id, progress) =>
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            functionCallProgress: progress,
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

  getSessionById: (id) => {
    return get().sessions[id];
  },

  hasUnread: () => {
    const { sessions } = get();
    return Object.values(sessions).some(
      (s) => s !== undefined && s.status !== 'idle' && !s.isRead
    );
  },

  hasRunningTasks: () => {
    const { sessions } = get();
    return Object.values(sessions).some(
      (s) => s !== undefined && s.status === 'running'
    );
  },

  // Notification actions
  markAllAsRead: () => {
    set((state) => {
      const updated: Record<string, AnySession | undefined> = {};
      for (const [id, session] of Object.entries(state.sessions)) {
        if (session) {
          updated[id] = { ...session, isRead: true };
        }
      }
      return { sessions: updated };
    });
  },

  clearNotification: (id) => {
    set((state) => {
      if (!state.sessions[id]) {
        return state;
      }
      const next = { ...state.sessions };
      delete next[id];
      return { sessions: next };
    });
  },

  clearAllNotifications: () => {
    set({ sessions: {} });
  },

  // Abort controller management
  registerAbortController: (id, controller) => {
    abortControllers.set(id, controller);
  },

  unregisterAbortController: (id) => {
    abortControllers.delete(id);
  },

  cancelTask: (id) => {
    // 1. Abort the request
    const controller = abortControllers.get(id);
    if (controller) {
      controller.abort();
      abortControllers.delete(id);
    }
    // 2. Update status to cancelled
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

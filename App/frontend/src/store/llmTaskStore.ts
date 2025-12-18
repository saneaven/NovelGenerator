import { create } from 'zustand';
import type { ContentPart, FunctionCallProgress, TokenUsage } from '../llm/requestTypes';

export type TaskSessionStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled';

// AbortController registry (outside Zustand store to avoid serialization issues)
const abortControllers = new Map<string, AbortController>();

// Task types for different LLM operations
export type LLMTaskType =
  | 'ai-edit'           // AIEditModal
  | 'chapter-edit'      // ManuscriptAIEditModal
  | 'translation'       // TranslationModal (story objects)
  | 'chat-translation'  // ChatPanel inline (single message)
  | 'image-prompt'      // ImagePromptBuilderModal
  | 'scene-image'       // SceneImageGeneratorModal
  | 'chat';             // Main chat in Workspace

export interface TaskProgress {
  current: number;
  total: number;
  currentItemLabel?: string;
}

export interface RetryContext {
  taskType: LLMTaskType;
  modalProps: Record<string, any>;
  formState?: Record<string, any>;
  callbacks?: {
    onResult?: (result?: any) => void;
  };
}

export interface LLMTaskSessionState {
  id: string;
  status: TaskSessionStatus;
  contentParts: ContentPart[];
  thinkingParts: ContentPart[];
  functionCallProgress: FunctionCallProgress[];
  error?: string;
  updatedAt: number;
  // Notification-related fields
  taskType?: LLMTaskType;
  label?: string;
  progress?: TaskProgress;
  retryContext?: RetryContext;
  isRead: boolean;
  createdAt: number;
  // Debug info fields
  provider?: string;
  model?: string;
  usage?: TokenUsage;
}

const createDefaultSession = (id: string): LLMTaskSessionState => ({
  id,
  status: 'idle',
  contentParts: [],
  thinkingParts: [],
  functionCallProgress: [],
  updatedAt: Date.now(),
  createdAt: Date.now(),
  isRead: false,
});

interface LLMTaskStore {
  sessions: Record<string, LLMTaskSessionState | undefined>;

  // Core session management
  initializeSession: (id: string) => void;
  updateSession: (id: string, partial: Partial<Omit<LLMTaskSessionState, 'id'>>) => void;
  setContentParts: (id: string, contentParts: ContentPart[]) => void;
  setThinkingParts: (id: string, thinkingParts: ContentPart[]) => void;
  setFunctionCallProgress: (id: string, progress: FunctionCallProgress[]) => void;
  clearSession: (id: string) => void;

  // Notification convenience methods
  setRunning: (id: string, label: string, taskType: LLMTaskType, retryContext?: RetryContext) => void;
  setSuccess: (id: string) => void;
  setTaskError: (id: string, message: string) => void;
  setCancelled: (id: string) => void;
  setProgress: (id: string, current: number, total: number, currentItemLabel?: string) => void;

  // Query helpers
  getActiveSessions: () => LLMTaskSessionState[];
  getSessionById: (id: string) => LLMTaskSessionState | undefined;
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
  initializeSession: (id: string) =>
    set((state) => {
      if (state.sessions[id]) {
        return state;
      }
      return {
        sessions: {
          ...state.sessions,
          [id]: createDefaultSession(id),
        },
      };
    }),
  updateSession: (id, partial) =>
    set((state) => {
      const existing = state.sessions[id] ?? createDefaultSession(id);
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            ...partial,
            updatedAt: Date.now(),
          },
        },
      };
    }),
  setContentParts: (id, contentParts) =>
    set((state) => {
      const existing = state.sessions[id] ?? createDefaultSession(id);
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
  setThinkingParts: (id, thinkingParts) =>
    set((state) => {
      const existing = state.sessions[id] ?? createDefaultSession(id);
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            thinkingParts,
            updatedAt: Date.now(),
          },
        },
      };
    }),
  setFunctionCallProgress: (id, progress) =>
    set((state) => {
      const existing = state.sessions[id] ?? createDefaultSession(id);
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

  // Toast convenience methods
  setRunning: (id, label, taskType, retryContext) => {
    const now = Date.now();
    set((state) => ({
      sessions: {
        ...state.sessions,
        [id]: {
          ...(state.sessions[id] ?? createDefaultSession(id)),
          status: 'running',
          label,
          taskType,
          retryContext,
          progress: undefined,
          error: undefined,
          isRead: false,
          createdAt: state.sessions[id]?.createdAt ?? now,
          updatedAt: now,
        },
      },
    }));
  },

  setSuccess: (id) => {
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            status: 'success',
            error: undefined,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  setTaskError: (id, message) => {
    // Log detailed error to console for debugging
    const existing = get().sessions[id];
    if (existing) {
      console.error(`[LLM Task Error] ${existing.label || 'Unknown Task'}`, {
        sessionId: id,
        taskType: existing.taskType,
        error: message,
        provider: existing.provider,
        model: existing.model,
        usage: existing.usage,
        hadContent: existing.contentParts && existing.contentParts.length > 0,
        progress: existing.progress,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.error(`[LLM Task Error] Session not found: ${id}`, message);
    }

    set((state) => {
      const session = state.sessions[id];
      if (!session) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...session,
            status: 'error',
            error: message,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  setCancelled: (id) => {
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

  setProgress: (id, current, total, currentItemLabel) => {
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            progress: { current, total, currentItemLabel },
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  // Query helpers
  getActiveSessions: () => {
    const { sessions } = get();
    return Object.values(sessions)
      .filter((s): s is LLMTaskSessionState => s !== undefined && s.status !== 'idle')
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
      const updated: Record<string, LLMTaskSessionState> = {};
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

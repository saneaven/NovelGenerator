import { create } from 'zustand';
import type { ContentPart, FunctionCallProgress } from '../llm/requestTypes';

export type TaskSessionStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled';

// Task types for different LLM operations
export type LLMTaskType =
  | 'ai-edit'           // AIEditModal
  | 'chapter-edit'      // NovelChapterAIEditModal
  | 'batch-translation' // BatchTranslationModal (story objects)
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
  // Toast-related fields
  taskType?: LLMTaskType;
  label?: string;
  progress?: TaskProgress;
  retryContext?: RetryContext;
  autoDismissMs?: number;
  createdAt: number;
}

const DEFAULT_SUCCESS_DISMISS_MS = 3000;

const createDefaultSession = (id: string): LLMTaskSessionState => ({
  id,
  status: 'idle',
  contentParts: [],
  thinkingParts: [],
  functionCallProgress: [],
  updatedAt: Date.now(),
  createdAt: Date.now(),
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

  // Toast convenience methods
  setRunning: (id: string, label: string, taskType: LLMTaskType, retryContext?: RetryContext) => void;
  setSuccess: (id: string, autoDismissMs?: number) => void;
  setTaskError: (id: string, message: string) => void;
  setCancelled: (id: string) => void;
  setProgress: (id: string, current: number, total: number, currentItemLabel?: string) => void;

  // Query helpers
  getActiveSessions: () => LLMTaskSessionState[];
  getSessionById: (id: string) => LLMTaskSessionState | undefined;

  // Bulk operations
  dismissAll: () => void;
  clearCompleted: () => void;
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
          autoDismissMs: undefined,
          createdAt: state.sessions[id]?.createdAt ?? now,
          updatedAt: now,
        },
      },
    }));
  },

  setSuccess: (id, autoDismissMs = DEFAULT_SUCCESS_DISMISS_MS) => {
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            status: 'success',
            autoDismissMs,
            error: undefined,
            updatedAt: Date.now(),
          },
        },
      };
    });
  },

  setTaskError: (id, message) => {
    set((state) => {
      const existing = state.sessions[id];
      if (!existing) return state;
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            status: 'error',
            error: message,
            autoDismissMs: undefined,
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
            autoDismissMs: DEFAULT_SUCCESS_DISMISS_MS,
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

  // Bulk operations
  dismissAll: () => {
    set({ sessions: {} });
  },

  clearCompleted: () => {
    set((state) => {
      const remaining: Record<string, LLMTaskSessionState> = {};
      for (const [id, session] of Object.entries(state.sessions)) {
        if (session && session.status === 'running') {
          remaining[id] = session;
        }
      }
      return { sessions: remaining };
    });
  },
}));

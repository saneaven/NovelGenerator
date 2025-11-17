import { create } from 'zustand';
import type { ContentPart, FunctionCallProgress } from '../llm_request/types';

export type TaskSessionStatus = 'idle' | 'running' | 'success' | 'error' | 'cancelled';

export interface LLMTaskSessionState {
  id: string;
  status: TaskSessionStatus;
  contentParts: ContentPart[];
  reasoningParts: ContentPart[];
  functionCallProgress: FunctionCallProgress[];
  error?: string;
  updatedAt: number;
}

const createDefaultSession = (id: string): LLMTaskSessionState => ({
  id,
  status: 'idle',
  contentParts: [],
  reasoningParts: [],
  functionCallProgress: [],
  updatedAt: Date.now(),
});

interface LLMTaskStore {
  sessions: Record<string, LLMTaskSessionState | undefined>;
  initializeSession: (id: string) => void;
  updateSession: (id: string, partial: Partial<Omit<LLMTaskSessionState, 'id'>>) => void;
  setContentParts: (id: string, contentParts: ContentPart[]) => void;
  setReasoningParts: (id: string, reasoningParts: ContentPart[]) => void;
  setFunctionCallProgress: (id: string, progress: FunctionCallProgress[]) => void;
  clearSession: (id: string) => void;
}

export const useLLMTaskStore = create<LLMTaskStore>((set) => ({
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
  setReasoningParts: (id, reasoningParts) =>
    set((state) => {
      const existing = state.sessions[id] ?? createDefaultSession(id);
      return {
        sessions: {
          ...state.sessions,
          [id]: {
            ...existing,
            reasoningParts,
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
}));

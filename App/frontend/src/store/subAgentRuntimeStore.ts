import { create } from 'zustand';
import type { ChatMessage } from '../llm/requestTypes';
import type { TaskAIConfig } from './settingsStore';
import type { ToolCallSchema } from '../toolCall';
import type { HandlerOptions } from '../toolCall/apply/types';

export type SubAgentInvocationStatus =
  | 'running'
  | 'awaiting_confirmation'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface SubAgentInvocation {
  /** Invocation ID (same as parentToolCallId for 1:1 mapping) */
  id: string;
  parentToolCallId: string;

  projectId: string;
  language: string;

  subAgentId: string;
  displayName: string;
  input: any;

  llmConfig: TaskAIConfig;
  tools: ToolCallSchema[];
  handlerOptions: HandlerOptions;

  status: SubAgentInvocationStatus;
  history: ChatMessage[];

  /** Current LLM session id (streaming / pending_confirmation applies to this session) */
  activeSessionId: string | null;

  finalOutput?: string;
  error?: string;
}

interface SubAgentRuntimeState {
  invocationsByToolCallId: Record<string, SubAgentInvocation | undefined>;
}

interface SubAgentRuntimeActions {
  getInvocation: (parentToolCallId: string) => SubAgentInvocation | undefined;
  upsertInvocation: (invocation: SubAgentInvocation) => void;
  updateInvocation: (parentToolCallId: string, partial: Partial<SubAgentInvocation>) => void;
  appendHistory: (parentToolCallId: string, message: ChatMessage) => void;
  replaceHistory: (parentToolCallId: string, history: ChatMessage[]) => void;
  clearInvocation: (parentToolCallId: string) => void;
}

export const useSubAgentRuntimeStore = create<SubAgentRuntimeState & SubAgentRuntimeActions>((set, get) => ({
  invocationsByToolCallId: {},

  getInvocation: (parentToolCallId) => get().invocationsByToolCallId[parentToolCallId],

  upsertInvocation: (invocation) =>
    set((state) => ({
      invocationsByToolCallId: {
        ...state.invocationsByToolCallId,
        [invocation.parentToolCallId]: invocation,
      },
    })),

  updateInvocation: (parentToolCallId, partial) =>
    set((state) => {
      const existing = state.invocationsByToolCallId[parentToolCallId];
      if (!existing) return state;
      return {
        invocationsByToolCallId: {
          ...state.invocationsByToolCallId,
          [parentToolCallId]: {
            ...existing,
            ...partial,
          },
        },
      };
    }),

  appendHistory: (parentToolCallId, message) =>
    set((state) => {
      const existing = state.invocationsByToolCallId[parentToolCallId];
      if (!existing) return state;
      return {
        invocationsByToolCallId: {
          ...state.invocationsByToolCallId,
          [parentToolCallId]: {
            ...existing,
            history: [...existing.history, message],
          },
        },
      };
    }),

  replaceHistory: (parentToolCallId, history) =>
    set((state) => {
      const existing = state.invocationsByToolCallId[parentToolCallId];
      if (!existing) return state;
      return {
        invocationsByToolCallId: {
          ...state.invocationsByToolCallId,
          [parentToolCallId]: {
            ...existing,
            history,
          },
        },
      };
    }),

  clearInvocation: (parentToolCallId) =>
    set((state) => {
      if (!state.invocationsByToolCallId[parentToolCallId]) return state;
      const next = { ...state.invocationsByToolCallId };
      delete next[parentToolCallId];
      return { invocationsByToolCallId: next };
    }),
}));

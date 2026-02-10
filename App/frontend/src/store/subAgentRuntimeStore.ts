import { create } from 'zustand';
import type { ChatMessage } from '../llm/requestTypes';
import type { TaskAIConfig } from './settingsStore';
import type { ToolCallSchema } from '../toolCall';
import type { HandlerOptions } from '../toolCall/apply/types';
import type { InvocationCaller } from '../types/agentRuntime';

export type SubAgentInvocationStatus =
  | 'running'
  | 'awaiting_confirmation'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled';

export type SubAgentParentType = 'agent' | 'sub_agent';

export interface SubAgentInvocationRef {
  parentType: SubAgentParentType;
  parentId: string;
  parentMessageId: string;
  parentToolCallId: string;
}

export function buildSubAgentInvocationKey(ref: SubAgentInvocationRef): string {
  return `${ref.parentType}:${ref.parentId}:${ref.parentMessageId}:${ref.parentToolCallId}`;
}

export interface SubAgentInvocation {
  /** Local runtime id */
  id: string;
  /** Persistent DB id (set once snapshot is saved) */
  persistentId?: string;

  parentType: SubAgentParentType;
  parentId: string;
  parentMessageId: string;
  parentToolCallId: string;

  projectId: string;
  agentId: string;
  language: string;
  caller: InvocationCaller;

  /** Tool suffix (call_{agentName}) used for prompt template name. */
  agentName: string;
  subAgentId: string;
  displayName: string;
  input: string;

  llmConfig?: TaskAIConfig;
  tools?: ToolCallSchema[];
  handlerOptions?: HandlerOptions;

  status: SubAgentInvocationStatus;
  history: ChatMessage[];

  /** Current LLM session id (streaming / pending_confirmation applies to this session) */
  activeSessionId: string | null;

  finalOutput?: string;
  error?: string;
}

interface SubAgentRuntimeState {
  invocationsByKey: Record<string, SubAgentInvocation | undefined>;
}

interface SubAgentRuntimeActions {
  getInvocationByKey: (invocationKey: string) => SubAgentInvocation | undefined;
  getInvocation: (ref: SubAgentInvocationRef) => SubAgentInvocation | undefined;
  listInvocationsByParent: (parentType: SubAgentParentType, parentId: string, parentMessageId?: string) => SubAgentInvocation[];
  hasBlockingInvocationsForAgent: (agentId: string) => boolean;
  upsertInvocation: (invocation: SubAgentInvocation) => void;
  updateInvocation: (invocationKey: string, partial: Partial<SubAgentInvocation>) => void;
  appendHistory: (invocationKey: string, message: ChatMessage) => void;
  replaceHistory: (invocationKey: string, history: ChatMessage[]) => void;
  clearInvocation: (invocationKey: string) => void;
}

export const useSubAgentRuntimeStore = create<SubAgentRuntimeState & SubAgentRuntimeActions>((set, get) => ({
  invocationsByKey: {},

  getInvocationByKey: (invocationKey) => get().invocationsByKey[invocationKey],

  getInvocation: (ref) => get().invocationsByKey[buildSubAgentInvocationKey(ref)],

  listInvocationsByParent: (parentType, parentId, parentMessageId) => {
    return Object.values(get().invocationsByKey).filter((invocation): invocation is SubAgentInvocation => {
      if (!invocation) return false;
      if (invocation.parentType !== parentType) return false;
      if (invocation.parentId !== parentId) return false;
      if (parentMessageId && invocation.parentMessageId !== parentMessageId) return false;
      return true;
    });
  },

  hasBlockingInvocationsForAgent: (agentId) =>
    Object.values(get().invocationsByKey).some((invocation) => {
      if (!invocation) return false;
      if (invocation.parentType !== 'agent') return false;
      if (invocation.parentId !== agentId) return false;
      return (
        invocation.status === 'running' ||
        invocation.status === 'awaiting_confirmation' ||
        invocation.status === 'paused'
      );
    }),

  upsertInvocation: (invocation) =>
    set((state) => {
      const key = buildSubAgentInvocationKey({
        parentType: invocation.parentType,
        parentId: invocation.parentId,
        parentMessageId: invocation.parentMessageId,
        parentToolCallId: invocation.parentToolCallId,
      });

      return {
        invocationsByKey: {
          ...state.invocationsByKey,
          [key]: invocation,
        },
      };
    }),

  updateInvocation: (invocationKey, partial) =>
    set((state) => {
      const existing = state.invocationsByKey[invocationKey];
      if (!existing) return state;
      return {
        invocationsByKey: {
          ...state.invocationsByKey,
          [invocationKey]: {
            ...existing,
            ...partial,
          },
        },
      };
    }),

  appendHistory: (invocationKey, message) =>
    set((state) => {
      const existing = state.invocationsByKey[invocationKey];
      if (!existing) return state;
      return {
        invocationsByKey: {
          ...state.invocationsByKey,
          [invocationKey]: {
            ...existing,
            history: [...existing.history, message],
          },
        },
      };
    }),

  replaceHistory: (invocationKey, history) =>
    set((state) => {
      const existing = state.invocationsByKey[invocationKey];
      if (!existing) return state;
      return {
        invocationsByKey: {
          ...state.invocationsByKey,
          [invocationKey]: {
            ...existing,
            history,
          },
        },
      };
    }),

  clearInvocation: (invocationKey) =>
    set((state) => {
      if (!state.invocationsByKey[invocationKey]) return state;
      const next = { ...state.invocationsByKey };
      delete next[invocationKey];
      return { invocationsByKey: next };
    }),
}));

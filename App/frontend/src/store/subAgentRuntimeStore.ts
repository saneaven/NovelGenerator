import { create } from 'zustand';
import type { ChatMessage } from '../llm/requestTypes';
import type { TemplateData } from '../llm/types';
import type { TaskAIConfig } from './settingsStore';
import type { ToolCallSchema } from '../toolCall';
import type { HandlerOptions } from '../toolCall/apply/types';
import type { InvocationCaller } from '../types/agentRuntime';

export type SubAgentRunStatus =
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'error'
  | 'cancelled';

export type SubAgentParentType = 'agent' | 'sub_agent';

export interface SubAgentRunRef {
  parentType: SubAgentParentType;
  parentId: string;
  parentMessageId: string;
  parentToolCallId: string;
}

export function buildSubAgentRunKey(ref: SubAgentRunRef): string {
  return `${ref.parentType}:${ref.parentId}:${ref.parentMessageId}:${ref.parentToolCallId}`;
}

export interface SubAgentRun {
  /** Local runtime id */
  id: string;
  /** Persistent DB id (set once state is saved) */
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

  status: SubAgentRunStatus;
  history: ChatMessage[];

  /** Number of LLM turns executed in the current run loop. */
  turnCount: number;

  /** Maps local temp message IDs → server-assigned UUIDs. */
  messageIdMap: Record<string, string>;

  /** Current LLM session id for an active Sub Agent turn. */
  activeSessionId: string | null;

  finalOutput?: string;
  error?: string;

  /** Frozen project data snapshot for auto-continue context drift prevention (in-memory only). */
  frozenProjectData?: TemplateData['project'];
}

interface SubAgentRuntimeState {
  runsByKey: Record<string, SubAgentRun | undefined>;
}

interface SubAgentRuntimeActions {
  getRunByKey: (runKey: string) => SubAgentRun | undefined;
  getRun: (ref: SubAgentRunRef) => SubAgentRun | undefined;
  listRunsByParent: (parentType: SubAgentParentType, parentId: string, parentMessageId?: string) => SubAgentRun[];
  hasBlockingRunsForAgent: (agentId: string) => boolean;
  upsertRun: (run: SubAgentRun) => void;
  updateRun: (runKey: string, partial: Partial<SubAgentRun>) => void;
  setMessageServerId: (runKey: string, localMsgId: string, serverMsgId: string) => void;
  appendHistory: (runKey: string, message: ChatMessage) => void;
  replaceHistory: (runKey: string, history: ChatMessage[]) => void;
  clearRun: (runKey: string) => void;
}

export const useSubAgentRuntimeStore = create<SubAgentRuntimeState & SubAgentRuntimeActions>((set, get) => ({
  runsByKey: {},

  getRunByKey: (runKey) => get().runsByKey[runKey],

  getRun: (ref) => get().runsByKey[buildSubAgentRunKey(ref)],

  listRunsByParent: (parentType, parentId, parentMessageId) => {
    return Object.values(get().runsByKey).filter((run): run is SubAgentRun => {
      if (!run) return false;
      if (run.parentType !== parentType) return false;
      if (run.parentId !== parentId) return false;
      if (parentMessageId && run.parentMessageId !== parentMessageId) return false;
      return true;
    });
  },

  hasBlockingRunsForAgent: (agentId) =>
    Object.values(get().runsByKey).some((run) => {
      if (!run) return false;
      if (run.parentType !== 'agent') return false;
      if (run.parentId !== agentId) return false;
      return (
        run.status === 'running' ||
        run.status === 'waiting' ||
        run.status === 'paused' ||
        run.status === 'error'
      );
    }),

  upsertRun: (run) =>
    set((state) => {
      const key = buildSubAgentRunKey({
        parentType: run.parentType,
        parentId: run.parentId,
        parentMessageId: run.parentMessageId,
        parentToolCallId: run.parentToolCallId,
      });

      return {
        runsByKey: {
          ...state.runsByKey,
          [key]: run,
        },
      };
    }),

  updateRun: (runKey, partial) =>
    set((state) => {
      const existing = state.runsByKey[runKey];
      if (!existing) return state;
      return {
        runsByKey: {
          ...state.runsByKey,
          [runKey]: {
            ...existing,
            ...partial,
          },
        },
      };
    }),

  setMessageServerId: (runKey, localMsgId, serverMsgId) =>
    set((state) => {
      const existing = state.runsByKey[runKey];
      if (!existing) return state;
      return {
        runsByKey: {
          ...state.runsByKey,
          [runKey]: {
            ...existing,
            messageIdMap: {
              ...existing.messageIdMap,
              [localMsgId]: serverMsgId,
            },
          },
        },
      };
    }),

  appendHistory: (runKey, message) =>
    set((state) => {
      const existing = state.runsByKey[runKey];
      if (!existing) return state;
      return {
        runsByKey: {
          ...state.runsByKey,
          [runKey]: {
            ...existing,
            history: [...existing.history, message],
          },
        },
      };
    }),

  replaceHistory: (runKey, history) =>
    set((state) => {
      const existing = state.runsByKey[runKey];
      if (!existing) return state;
      return {
        runsByKey: {
          ...state.runsByKey,
          [runKey]: {
            ...existing,
            history,
          },
        },
      };
    }),

  clearRun: (runKey) =>
    set((state) => {
      if (!state.runsByKey[runKey]) return state;
      const next = { ...state.runsByKey };
      delete next[runKey];
      return { runsByKey: next };
    }),
}));

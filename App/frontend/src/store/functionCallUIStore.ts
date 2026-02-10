import { create } from 'zustand';
import type { PatchDecision } from '../functionCalls/types';

interface FunctionCallUIState {
  expandedByThread: Record<string, Record<string, boolean> | undefined>;
  patchDecisionsByThread: Record<string, Record<string, PatchDecision> | undefined>;
  peekOpenByThread: Record<string, boolean | undefined>;
  selectedPeekInvocationByThread: Record<string, string | undefined>;
}

interface FunctionCallUIActions {
  isExpanded: (threadId: string, cardId: string, defaultExpanded?: boolean) => boolean;
  setExpanded: (threadId: string, cardId: string, expanded: boolean) => void;
  toggleExpanded: (threadId: string, cardId: string, defaultExpanded?: boolean) => void;

  getPatchDecision: (threadId: string, operationId: string, fallback?: PatchDecision) => PatchDecision;
  setPatchDecision: (threadId: string, operationId: string, decision: PatchDecision) => void;
  setPatchDecisionsBulk: (threadId: string, operationIds: string[], decision: PatchDecision) => void;

  isPeekOpen: (threadId: string, defaultOpen?: boolean) => boolean;
  setPeekOpen: (threadId: string, open: boolean) => void;
  togglePeekOpen: (threadId: string, defaultOpen?: boolean) => void;

  getSelectedPeekInvocation: (threadId: string) => string | undefined;
  setSelectedPeekInvocation: (threadId: string, invocationKey: string | undefined) => void;

  clearThread: (threadId: string) => void;
}

export const useFunctionCallUIStore = create<FunctionCallUIState & FunctionCallUIActions>((set, get) => ({
  expandedByThread: {},
  patchDecisionsByThread: {},
  peekOpenByThread: {},
  selectedPeekInvocationByThread: {},

  isExpanded: (threadId, cardId, defaultExpanded = false) => {
    const thread = get().expandedByThread[threadId];
    if (!thread || !(cardId in thread)) return defaultExpanded;
    return Boolean(thread[cardId]);
  },

  setExpanded: (threadId, cardId, expanded) =>
    set((state) => ({
      expandedByThread: {
        ...state.expandedByThread,
        [threadId]: {
          ...(state.expandedByThread[threadId] ?? {}),
          [cardId]: expanded,
        },
      },
    })),

  toggleExpanded: (threadId, cardId, defaultExpanded = false) => {
    const current = get().isExpanded(threadId, cardId, defaultExpanded);
    get().setExpanded(threadId, cardId, !current);
  },

  getPatchDecision: (threadId, operationId, fallback = 'accept') => {
    const thread = get().patchDecisionsByThread[threadId];
    if (!thread || !(operationId in thread)) return fallback;
    return thread[operationId] ?? fallback;
  },

  setPatchDecision: (threadId, operationId, decision) =>
    set((state) => ({
      patchDecisionsByThread: {
        ...state.patchDecisionsByThread,
        [threadId]: {
          ...(state.patchDecisionsByThread[threadId] ?? {}),
          [operationId]: decision,
        },
      },
    })),

  setPatchDecisionsBulk: (threadId, operationIds, decision) =>
    set((state) => {
      const current = { ...(state.patchDecisionsByThread[threadId] ?? {}) };
      for (const operationId of operationIds) {
        current[operationId] = decision;
      }
      return {
        patchDecisionsByThread: {
          ...state.patchDecisionsByThread,
          [threadId]: current,
        },
      };
    }),

  isPeekOpen: (threadId, defaultOpen = true) => {
    const value = get().peekOpenByThread[threadId];
    if (typeof value !== 'boolean') return defaultOpen;
    return value;
  },

  setPeekOpen: (threadId, open) =>
    set((state) => ({
      peekOpenByThread: {
        ...state.peekOpenByThread,
        [threadId]: open,
      },
    })),

  togglePeekOpen: (threadId, defaultOpen = true) => {
    const current = get().isPeekOpen(threadId, defaultOpen);
    get().setPeekOpen(threadId, !current);
  },

  getSelectedPeekInvocation: (threadId) => get().selectedPeekInvocationByThread[threadId],

  setSelectedPeekInvocation: (threadId, invocationKey) =>
    set((state) => ({
      selectedPeekInvocationByThread: {
        ...state.selectedPeekInvocationByThread,
        [threadId]: invocationKey,
      },
    })),

  clearThread: (threadId) =>
    set((state) => {
      const expandedByThread = { ...state.expandedByThread };
      const patchDecisionsByThread = { ...state.patchDecisionsByThread };
      const peekOpenByThread = { ...state.peekOpenByThread };
      const selectedPeekInvocationByThread = { ...state.selectedPeekInvocationByThread };

      delete expandedByThread[threadId];
      delete patchDecisionsByThread[threadId];
      delete peekOpenByThread[threadId];
      delete selectedPeekInvocationByThread[threadId];

      return {
        expandedByThread,
        patchDecisionsByThread,
        peekOpenByThread,
        selectedPeekInvocationByThread,
      };
    }),
}));

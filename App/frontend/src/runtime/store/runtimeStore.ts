import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Run, RunMessage, RunMessageLangEntry, RunToolCall } from '../types';

interface RuntimeState {
  runsById: Record<string, Run | undefined>;
  runMessagesByRunId: Record<string, RunMessage[] | undefined>;
  runToolCallsByMessageId: Record<string, RunToolCall[] | undefined>;
}

interface RuntimeActions {
  clearAll: () => void;
  upsertRun: (run: Run) => void;
  upsertRuns: (runs: Run[]) => void;
  removeRun: (runId: string) => void;
  patchRun: (runId: string, partial: Partial<Run>) => void;
  getRun: (runId: string) => Run | undefined;
  listRuns: (filter?: { projectId?: string; agentId?: string; runType?: Run['runType'] }) => Run[];
  findLatestOpenRootRunId: (projectId: string, agentId: string) => string | undefined;
  findChildRuns: (parentRunId: string, parentRunMessageId?: string) => Run[];
  replaceRunMessages: (runId: string, messages: RunMessage[]) => void;
  appendRunMessage: (message: RunMessage) => void;
  patchRunMessage: (runId: string, messageId: string, partial: Partial<RunMessage>) => void;
  getRunMessages: (runId: string) => RunMessage[];
  updateRunMessageData: (runId: string, messageId: string, language: string, entry: RunMessageLangEntry) => void;
  addRunMessageTranslation: (runId: string, messageId: string, language: string, entry: RunMessageLangEntry) => void;
  clearRunMessageTranslations: (runId: string, messageId: string, preserveLanguages: string[]) => void;
  upsertRunToolCalls: (runMessageId: string, toolCalls: RunToolCall[]) => void;
  getRunToolCalls: (runMessageId: string) => RunToolCall[];
  removeRunMessage: (runId: string, messageId: string) => void;
  removeRunsByIds: (runIds: string[]) => void;
}

export const useRuntimeStore = create<RuntimeState & RuntimeActions>()(
  persist(
    (set, get) => ({
      runsById: {},
      runMessagesByRunId: {},
      runToolCallsByMessageId: {},

      clearAll: () => set({
        runsById: {},
        runMessagesByRunId: {},
        runToolCallsByMessageId: {},
      }),

      upsertRun: (run) => set((state) => ({
        runsById: {
          ...state.runsById,
          [run.id]: run,
        },
      })),

      upsertRuns: (runs) => set((state) => {
        if (runs.length === 0) return state;
        const next = { ...state.runsById };
        for (const run of runs) {
          next[run.id] = run;
        }
        return { runsById: next };
      }),

      removeRun: (runId) => set((state) => {
        if (!state.runsById[runId]) return state;
        const nextRuns = { ...state.runsById };
        delete nextRuns[runId];

        const nextMessages = { ...state.runMessagesByRunId };
        const removedMessages = nextMessages[runId] ?? [];
        delete nextMessages[runId];

        const nextToolCalls = { ...state.runToolCallsByMessageId };
        for (const message of removedMessages) {
          delete nextToolCalls[message.id];
        }

        return {
          runsById: nextRuns,
          runMessagesByRunId: nextMessages,
          runToolCallsByMessageId: nextToolCalls,
        };
      }),

      patchRun: (runId, partial) => set((state) => {
        const current = state.runsById[runId];
        if (!current) return state;
        return {
          runsById: {
            ...state.runsById,
            [runId]: {
              ...current,
              ...partial,
            },
          },
        };
      }),

      getRun: (runId) => get().runsById[runId],

      listRuns: (filter) => {
        const runs = Object.values(get().runsById).filter((run): run is Run => Boolean(run));
        if (!filter) return runs;
        return runs.filter((run) => {
          if (filter.projectId && run.projectId !== filter.projectId) return false;
          if (filter.agentId && run.agentId !== filter.agentId) return false;
          if (filter.runType && run.runType !== filter.runType) return false;
          return true;
        });
      },

      findLatestOpenRootRunId: (projectId, agentId) => {
        const runs = Object.values(get().runsById).filter((run): run is Run => Boolean(run));
        const candidates = runs.filter((run) => {
          if (run.projectId !== projectId) return false;
          if (run.agentId !== agentId) return false;
          if (run.runType !== 'agent') return false;
          return run.status !== 'completed' && run.status !== 'cancelled';
        });
        if (candidates.length === 0) return undefined;
        candidates.sort((left, right) => {
          const leftSeq = left.rootRunSeq ?? -1;
          const rightSeq = right.rootRunSeq ?? -1;
          if (leftSeq !== rightSeq) return rightSeq - leftSeq;
          return right.updatedAt.localeCompare(left.updatedAt);
        });
        return candidates[0]?.id;
      },

      findChildRuns: (parentRunId, parentRunMessageId) => {
        const runs = Object.values(get().runsById).filter((run): run is Run => Boolean(run));
        return runs
          .filter((run) => {
            if (run.runType !== 'subAgent') return false;
            if (run.parentRunId !== parentRunId) return false;
            if (parentRunMessageId && run.parentRunMessageId !== parentRunMessageId) return false;
            return true;
          })
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      },

      replaceRunMessages: (runId, messages) => set((state) => {
        const sorted = [...messages].sort((a, b) => a.seq - b.seq);
        return {
          runMessagesByRunId: {
            ...state.runMessagesByRunId,
            [runId]: sorted,
          },
        };
      }),

      appendRunMessage: (message) => set((state) => {
        const current = state.runMessagesByRunId[message.runId] ?? [];
        return {
          runMessagesByRunId: {
            ...state.runMessagesByRunId,
            [message.runId]: [...current, message].sort((a, b) => a.seq - b.seq),
          },
        };
      }),

      patchRunMessage: (runId, messageId, partial) => set((state) => {
        const messages = state.runMessagesByRunId[runId] ?? [];
        if (messages.length === 0) return state;
        const next = messages.map((message) => {
          if (message.id !== messageId) return message;
          return { ...message, ...partial };
        });
        return {
          runMessagesByRunId: {
            ...state.runMessagesByRunId,
            [runId]: next,
          },
        };
      }),

      getRunMessages: (runId) => [...(get().runMessagesByRunId[runId] ?? [])].sort((a, b) => a.seq - b.seq),

      updateRunMessageData: (runId, messageId, language, entry) => set((state) => {
        const messages = state.runMessagesByRunId[runId] ?? [];
        if (messages.length === 0) return state;
        const next = messages.map((message) => {
          if (message.id !== messageId) return message;
          return {
            ...message,
            data: { ...message.data, [language]: entry },
          };
        });
        return {
          runMessagesByRunId: {
            ...state.runMessagesByRunId,
            [runId]: next,
          },
        };
      }),

      addRunMessageTranslation: (runId, messageId, language, entry) => set((state) => {
        const messages = state.runMessagesByRunId[runId] ?? [];
        if (messages.length === 0) return state;
        const next = messages.map((message) => {
          if (message.id !== messageId) return message;
          return {
            ...message,
            data: { ...message.data, [language]: entry },
          };
        });
        return {
          runMessagesByRunId: {
            ...state.runMessagesByRunId,
            [runId]: next,
          },
        };
      }),

      clearRunMessageTranslations: (runId, messageId, preserveLanguages) => set((state) => {
        const messages = state.runMessagesByRunId[runId] ?? [];
        if (messages.length === 0) return state;
        const preserveSet = new Set(preserveLanguages);
        const next = messages.map((message) => {
          if (message.id !== messageId) return message;
          const filteredData: Record<string, RunMessageLangEntry> = {};
          for (const [lang, entry] of Object.entries(message.data)) {
            if (preserveSet.has(lang)) {
              filteredData[lang] = entry;
            }
          }
          return { ...message, data: filteredData };
        });
        return {
          runMessagesByRunId: {
            ...state.runMessagesByRunId,
            [runId]: next,
          },
        };
      }),

      upsertRunToolCalls: (runMessageId, toolCalls) => set((state) => ({
        runToolCallsByMessageId: {
          ...state.runToolCallsByMessageId,
          [runMessageId]: [...toolCalls].sort((a, b) => a.callSeq - b.callSeq),
        },
      })),

      getRunToolCalls: (runMessageId) => [...(get().runToolCallsByMessageId[runMessageId] ?? [])]
        .sort((a, b) => a.callSeq - b.callSeq),

      removeRunMessage: (runId, messageId) => set((state) => {
        const messages = state.runMessagesByRunId[runId] ?? [];
        const remaining = messages.filter((m) => m.id !== messageId);

        const nextToolCalls = { ...state.runToolCallsByMessageId };
        delete nextToolCalls[messageId];

        if (remaining.length === 0) {
          const nextRuns = { ...state.runsById };
          delete nextRuns[runId];
          const nextMessages = { ...state.runMessagesByRunId };
          delete nextMessages[runId];
          return {
            runsById: nextRuns,
            runMessagesByRunId: nextMessages,
            runToolCallsByMessageId: nextToolCalls,
          };
        }

        return {
          runMessagesByRunId: {
            ...state.runMessagesByRunId,
            [runId]: remaining,
          },
          runToolCallsByMessageId: nextToolCalls,
        };
      }),

      removeRunsByIds: (runIds) => set((state) => {
        if (runIds.length === 0) return state;

        const nextRuns = { ...state.runsById };
        const nextMessages = { ...state.runMessagesByRunId };
        const nextToolCalls = { ...state.runToolCallsByMessageId };
        for (const runId of runIds) {
          const messages = nextMessages[runId] ?? [];
          delete nextRuns[runId];
          delete nextMessages[runId];
          for (const message of messages) {
            delete nextToolCalls[message.id];
          }
        }

        return {
          runsById: nextRuns,
          runMessagesByRunId: nextMessages,
          runToolCallsByMessageId: nextToolCalls,
        };
      }),
    }),
    {
      name: 'runtime-store',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

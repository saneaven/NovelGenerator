/**
 * Live runtime signals for agent threads.
 *
 * Messages + tool calls — finalized AND in-progress streaming/optimistic/temp —
 * are the single source of truth in the TanStack Query snapshot cache
 * (`data/threads`). This store holds ONLY the non-message live signals that have
 * no persisted home:
 *   - thread metadata (status/error/counts) — live, patched by SSE
 *   - per-thread stage / active-stream / preexisting-live signals
 */

import { create } from 'zustand';
import type { ThreadInfo } from '../types/thread';

export type { ThreadInfo, ThreadMessage, ThreadToolCall } from '../types/thread';
export type { ThreadType, ThreadStatus } from '../types/thread';

export interface ThreadStreamState {
  /** Thread metadata (live status/error/counts). Global map. */
  threadsById: Record<string, ThreadInfo | undefined>;
  /** Threads whose live run is owned by another client/tab (stream suppressed). */
  preexistingLiveThreadsById: Record<string, true | undefined>;
  activeStreamByThread: Record<string, boolean | undefined>;
  currentStageByThread: Record<string, string | null>;

  // ---- thread metadata -----------------------------------------------------
  upsertThread: (thread: ThreadInfo) => void;
  upsertThreadsRuntime: (threads: ThreadInfo[]) => void;
  setThreadRuntime: (threadId: string, partial: Partial<ThreadInfo>) => void;
  patchThread: (threadId: string, partial: Partial<ThreadInfo>) => void;
  removeThreadMetadata: (threadId: string) => void;
  removeThreadsMetadata: (threadIds: string[]) => void;

  // ---- preexisting-live tracking ------------------------------------------
  markPreexistingLiveThreads: (threadIds: string[]) => void;
  clearPreexistingLiveThread: (threadId: string) => void;
  isPreexistingLiveThread: (threadId: string) => boolean;

  // ---- signals -------------------------------------------------------------
  setThreadStreamActive: (threadId: string, active: boolean) => void;
  isThreadStreamActive: (threadId: string) => boolean;
  setThreadStage: (threadId: string, stage: string | null) => void;
  /** Cancel/suppress: reset live signals for the thread. */
  clearThreadStreamingState: (threadId: string) => void;

  clearAll: () => void;
}

function mergeThreadInfo(
  existing: ThreadInfo,
  partial: Partial<ThreadInfo>,
): { changed: boolean; nextValue: ThreadInfo } {
  let changed = false;
  const nextValue: ThreadInfo = { ...existing };
  for (const [key, value] of Object.entries(partial) as Array<[keyof ThreadInfo, ThreadInfo[keyof ThreadInfo]]>) {
    if (Object.is(existing[key], value)) continue;
    nextValue[key] = value as never;
    changed = true;
  }
  return { changed, nextValue: changed ? nextValue : existing };
}

function removeThreadsState(state: ThreadStreamState, threadIds: string[]): Partial<ThreadStreamState> | ThreadStreamState {
  if (threadIds.length === 0) return state;
  const toDelete = new Set(threadIds);

  const nextThreadsById = { ...state.threadsById };
  const nextPreexisting = { ...state.preexistingLiveThreadsById };
  const nextActive = { ...state.activeStreamByThread };
  const nextStage = { ...state.currentStageByThread };

  for (const threadId of toDelete) {
    delete nextThreadsById[threadId];
    delete nextPreexisting[threadId];
    delete nextActive[threadId];
    delete nextStage[threadId];
  }

  return {
    threadsById: nextThreadsById,
    preexistingLiveThreadsById: nextPreexisting,
    activeStreamByThread: nextActive,
    currentStageByThread: nextStage,
  };
}

export const useThreadStreamStore = create<ThreadStreamState>()((set, get) => ({
  threadsById: {},
  preexistingLiveThreadsById: {},
  activeStreamByThread: {},
  currentStageByThread: {},

  upsertThread: (thread) =>
    set((s) => {
      const existing = s.threadsById[thread.id];
      if (existing) {
        const { changed, nextValue } = mergeThreadInfo(existing, thread);
        if (!changed) return s;
        return { threadsById: { ...s.threadsById, [thread.id]: nextValue } };
      }
      return { threadsById: { ...s.threadsById, [thread.id]: thread } };
    }),

  upsertThreadsRuntime: (threads) =>
    set((s) => {
      if (threads.length === 0) return s;
      const nextThreads = { ...s.threadsById };
      let changed = false;
      for (const thread of threads) {
        const existing = nextThreads[thread.id];
        if (!existing) {
          nextThreads[thread.id] = thread;
          changed = true;
          continue;
        }
        const merged = mergeThreadInfo(existing, thread);
        if (!merged.changed) continue;
        nextThreads[thread.id] = merged.nextValue;
        changed = true;
      }
      if (!changed) return s;
      return { threadsById: nextThreads };
    }),

  setThreadRuntime: (threadId, partial) =>
    set((s) => {
      const existing = s.threadsById[threadId];
      if (!existing) return s;
      const { changed, nextValue } = mergeThreadInfo(existing, partial);
      if (!changed) return s;
      return { threadsById: { ...s.threadsById, [threadId]: nextValue } };
    }),

  patchThread: (threadId, partial) =>
    set((s) => {
      const existing = s.threadsById[threadId];
      if (!existing) return s;
      const { changed, nextValue } = mergeThreadInfo(existing, partial);
      if (!changed) return s;
      return { threadsById: { ...s.threadsById, [threadId]: nextValue } };
    }),

  removeThreadMetadata: (threadId) =>
    set((s) => removeThreadsState(s, [threadId])),

  removeThreadsMetadata: (threadIds) =>
    set((s) => removeThreadsState(s, threadIds)),

  markPreexistingLiveThreads: (threadIds) =>
    set((s) => {
      if (threadIds.length === 0) return s;
      const next = { ...s.preexistingLiveThreadsById };
      for (const threadId of threadIds) {
        if (!threadId) continue;
        next[threadId] = true;
      }
      return { preexistingLiveThreadsById: next };
    }),

  clearPreexistingLiveThread: (threadId) =>
    set((s) => {
      if (!s.preexistingLiveThreadsById[threadId]) return s;
      const { [threadId]: _, ...rest } = s.preexistingLiveThreadsById;
      return { preexistingLiveThreadsById: rest };
    }),

  isPreexistingLiveThread: (threadId) => Boolean(get().preexistingLiveThreadsById[threadId]),

  setThreadStreamActive: (threadId, active) =>
    set((s) => {
      if (s.activeStreamByThread[threadId] === active) return s;
      return { activeStreamByThread: { ...s.activeStreamByThread, [threadId]: active } };
    }),

  isThreadStreamActive: (threadId) => Boolean(get().activeStreamByThread[threadId]),

  setThreadStage: (threadId, stage) =>
    set((s) => {
      const current = s.currentStageByThread[threadId] ?? null;
      if (current === stage) return s;
      return { currentStageByThread: { ...s.currentStageByThread, [threadId]: stage } };
    }),

  clearThreadStreamingState: (threadId) =>
    set((s) => {
      const streamActive = Boolean(s.activeStreamByThread[threadId]);
      const currentStage = s.currentStageByThread[threadId] ?? null;
      if (!streamActive && currentStage === null) return s;
      return {
        activeStreamByThread: { ...s.activeStreamByThread, [threadId]: false },
        currentStageByThread: { ...s.currentStageByThread, [threadId]: null },
      };
    }),

  clearAll: () =>
    set({
      threadsById: {},
      preexistingLiveThreadsById: {},
      activeStreamByThread: {},
      currentStageByThread: {},
    }),
}));

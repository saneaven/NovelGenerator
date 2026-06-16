/**
 * Live runtime buffer for agent threads (the client half of the thread hybrid).
 *
 * The PERSISTED snapshot — finalized messages + tool calls — lives in the
 * TanStack Query cache (`data/threads`). This store holds ONLY the live overlay
 * that has no persisted truth yet:
 *   - thread metadata (status/error/counts) — live, patched by SSE
 *   - the in-progress streaming assistant message (token/thinking deltas)
 *   - optimistic user messages (before the server echoes them back)
 *   - streaming temp-id tool calls (before tool_call:end finalizes them)
 *   - per-thread stage / active-stream / preexisting-live signals
 *
 * Consumers never read this directly for message lists; they read the merged
 * view from `data/threads/useThreadView` (snapshot ∪ overlay). Token deltas never
 * touch the query cache (no write amplification) — they accumulate here and are
 * reconciled into the snapshot on message:end / run:done.
 */

import { create } from 'zustand';
import type { ThreadInfo, ThreadMessage, ThreadToolCall } from '../types/thread';
import { revokeMessageAttachmentObjectUrls } from '../utils/threadAttachments';

export type { ThreadInfo, ThreadMessage, ThreadToolCall };
export type { ThreadType, ThreadStatus } from '../types/thread';

const EMPTY_OVERLAY_MESSAGES: ThreadMessage[] = [];

export interface ThreadStreamState {
  /** Thread metadata (live status/error/counts). Global map. */
  threadsById: Record<string, ThreadInfo | undefined>;
  /** Overlay messages per thread: optimistic user msgs + the streaming assistant msg. */
  overlayMessagesByThread: Record<string, ThreadMessage[] | undefined>;
  /** Streaming temp-id tool calls (status === 'streaming'), keyed by temp id. */
  streamingToolCallsById: Record<string, ThreadToolCall | undefined>;
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

  // ---- overlay messages ----------------------------------------------------
  ensureStreamingAssistantMessage: (params: {
    threadId: string;
    messageId: string;
    runId: string;
    seq?: number;
    seqInThread?: number;
  }) => ThreadMessage;
  patchStreamingMessage: (threadId: string, messageId: string, partial: Partial<ThreadMessage>) => void;
  appendOptimisticMessage: (message: ThreadMessage) => void;
  removeOverlayMessage: (threadId: string, messageId: string) => void;
  getOverlayMessages: (threadId: string) => ThreadMessage[];
  getOverlayMessage: (threadId: string, messageId: string) => ThreadMessage | undefined;
  /** Drop ALL overlay state for a thread once the snapshot owns its truth. */
  clearOverlayForThread: (threadId: string) => void;
  /** message:error — remove the in-progress streaming assistant message. */
  discardStreamingAssistantMessage: (threadId: string, messageId: string) => void;

  // ---- streaming temp tool calls ------------------------------------------
  upsertStreamingToolCall: (toolCall: ThreadToolCall) => void;
  patchStreamingToolCall: (toolCallId: string, partial: Partial<ThreadToolCall>) => void;
  removeStreamingToolCall: (toolCallId: string) => void;
  clearStreamingToolCallsForAssistant: (threadId: string, assistantMessageId: string) => void;

  // ---- signals -------------------------------------------------------------
  setThreadStreamActive: (threadId: string, active: boolean) => void;
  isThreadStreamActive: (threadId: string) => boolean;
  setThreadStage: (threadId: string, stage: string | null) => void;
  /** Cancel/suppress: drop streaming overlay + reset signals for the thread. */
  clearThreadStreamingState: (threadId: string) => void;

  clearAll: () => void;
}

function sortMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return [...messages].sort((a, b) => a.seqInThread - b.seqInThread);
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
  const nextOverlay = { ...state.overlayMessagesByThread };
  const nextPreexisting = { ...state.preexistingLiveThreadsById };
  const nextActive = { ...state.activeStreamByThread };
  const nextStage = { ...state.currentStageByThread };

  for (const threadId of toDelete) {
    for (const message of nextOverlay[threadId] ?? []) {
      revokeMessageAttachmentObjectUrls(message);
    }
    delete nextThreadsById[threadId];
    delete nextOverlay[threadId];
    delete nextPreexisting[threadId];
    delete nextActive[threadId];
    delete nextStage[threadId];
  }

  const nextStreamingToolCallsById: Record<string, ThreadToolCall | undefined> = {};
  for (const [id, toolCall] of Object.entries(state.streamingToolCallsById)) {
    if (!toolCall || toDelete.has(toolCall.threadId)) continue;
    nextStreamingToolCallsById[id] = toolCall;
  }

  return {
    threadsById: nextThreadsById,
    overlayMessagesByThread: nextOverlay,
    preexistingLiveThreadsById: nextPreexisting,
    streamingToolCallsById: nextStreamingToolCallsById,
    activeStreamByThread: nextActive,
    currentStageByThread: nextStage,
  };
}

export const useThreadStreamStore = create<ThreadStreamState>()((set, get) => ({
  threadsById: {},
  overlayMessagesByThread: {},
  streamingToolCallsById: {},
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

  ensureStreamingAssistantMessage: (params) => {
    const existing = get().overlayMessagesByThread[params.threadId]?.find((m) => m.id === params.messageId);
    if (existing) return existing;

    const message: ThreadMessage = {
      id: params.messageId,
      threadId: params.threadId,
      runId: params.runId,
      role: 'assistant',
      seq: params.seq ?? 0,
      seqInThread: params.seqInThread ?? 0,
      data: {},
      attachments: [],
      streamingData: { contentParts: [] },
      isStreaming: true,
      createdAt: new Date().toISOString(),
    };
    set((s) => {
      const existingList = s.overlayMessagesByThread[params.threadId] ?? [];
      return {
        overlayMessagesByThread: {
          ...s.overlayMessagesByThread,
          [params.threadId]: sortMessages([...existingList, message]),
        },
      };
    });
    return message;
  },

  patchStreamingMessage: (threadId, messageId, partial) =>
    set((s) => {
      const list = s.overlayMessagesByThread[threadId];
      if (!list) return s;
      let changed = false;
      const next = list.map((m) => {
        if (m.id !== messageId) return m;
        changed = true;
        return { ...m, ...partial };
      });
      if (!changed) return s;
      return { overlayMessagesByThread: { ...s.overlayMessagesByThread, [threadId]: next } };
    }),

  appendOptimisticMessage: (message) =>
    set((s) => {
      const existing = s.overlayMessagesByThread[message.threadId] ?? [];
      return {
        overlayMessagesByThread: {
          ...s.overlayMessagesByThread,
          [message.threadId]: sortMessages([...existing, message]),
        },
      };
    }),

  removeOverlayMessage: (threadId, messageId) =>
    set((s) => {
      const list = s.overlayMessagesByThread[threadId];
      if (!list) return s;
      const removed = list.find((m) => m.id === messageId);
      if (!removed) return s;
      revokeMessageAttachmentObjectUrls(removed);
      return {
        overlayMessagesByThread: {
          ...s.overlayMessagesByThread,
          [threadId]: list.filter((m) => m.id !== messageId),
        },
      };
    }),

  getOverlayMessages: (threadId) => get().overlayMessagesByThread[threadId] ?? EMPTY_OVERLAY_MESSAGES,

  getOverlayMessage: (threadId, messageId) =>
    get().overlayMessagesByThread[threadId]?.find((m) => m.id === messageId),

  clearOverlayForThread: (threadId) =>
    set((s) => {
      const hadMessages = Boolean(s.overlayMessagesByThread[threadId]?.length);
      const streamingForThread = Object.values(s.streamingToolCallsById).some((tc) => tc?.threadId === threadId);
      if (!hadMessages && !streamingForThread) return s;

      for (const message of s.overlayMessagesByThread[threadId] ?? []) {
        revokeMessageAttachmentObjectUrls(message);
      }
      const nextOverlay = { ...s.overlayMessagesByThread };
      delete nextOverlay[threadId];

      const nextStreaming: Record<string, ThreadToolCall | undefined> = {};
      for (const [id, tc] of Object.entries(s.streamingToolCallsById)) {
        if (!tc || tc.threadId === threadId) continue;
        nextStreaming[id] = tc;
      }
      return { overlayMessagesByThread: nextOverlay, streamingToolCallsById: nextStreaming };
    }),

  discardStreamingAssistantMessage: (threadId, messageId) =>
    set((s) => {
      const list = s.overlayMessagesByThread[threadId];
      const target = list?.find((m) => m.id === messageId);
      const currentStage = s.currentStageByThread[threadId] ?? null;

      if (!target || !target.isStreaming || target.role !== 'assistant') {
        const stageChange = currentStage === null ? {} : {
          currentStageByThread: { ...s.currentStageByThread, [threadId]: null },
        };
        return Object.keys(stageChange).length ? stageChange : s;
      }

      revokeMessageAttachmentObjectUrls(target);
      const nextStreaming: Record<string, ThreadToolCall | undefined> = {};
      for (const [id, tc] of Object.entries(s.streamingToolCallsById)) {
        if (!tc) continue;
        if (tc.threadId === threadId && tc.assistantMessageId === messageId) continue;
        nextStreaming[id] = tc;
      }

      return {
        overlayMessagesByThread: {
          ...s.overlayMessagesByThread,
          [threadId]: (list ?? []).filter((m) => m.id !== messageId),
        },
        streamingToolCallsById: nextStreaming,
        activeStreamByThread: { ...s.activeStreamByThread, [threadId]: false },
        currentStageByThread: { ...s.currentStageByThread, [threadId]: null },
      };
    }),

  upsertStreamingToolCall: (toolCall) =>
    set((s) => ({ streamingToolCallsById: { ...s.streamingToolCallsById, [toolCall.id]: toolCall } })),

  patchStreamingToolCall: (toolCallId, partial) =>
    set((s) => {
      const existing = s.streamingToolCallsById[toolCallId];
      if (!existing) return s;
      return {
        streamingToolCallsById: { ...s.streamingToolCallsById, [toolCallId]: { ...existing, ...partial } },
      };
    }),

  removeStreamingToolCall: (toolCallId) =>
    set((s) => {
      if (!s.streamingToolCallsById[toolCallId]) return s;
      const { [toolCallId]: _, ...rest } = s.streamingToolCallsById;
      return { streamingToolCallsById: rest };
    }),

  clearStreamingToolCallsForAssistant: (threadId, assistantMessageId) =>
    set((s) => {
      let changed = false;
      const next: Record<string, ThreadToolCall | undefined> = {};
      for (const [id, tc] of Object.entries(s.streamingToolCallsById)) {
        if (!tc) continue;
        if (tc.threadId === threadId && tc.assistantMessageId === assistantMessageId) {
          changed = true;
          continue;
        }
        next[id] = tc;
      }
      if (!changed) return s;
      return { streamingToolCallsById: next };
    }),

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
      const hadMessages = Boolean(s.overlayMessagesByThread[threadId]?.length);
      const streamingForThread = Object.values(s.streamingToolCallsById).some((tc) => tc?.threadId === threadId);
      const streamActive = Boolean(s.activeStreamByThread[threadId]);
      const currentStage = s.currentStageByThread[threadId] ?? null;
      if (!hadMessages && !streamingForThread && !streamActive && currentStage === null) return s;

      for (const message of s.overlayMessagesByThread[threadId] ?? []) {
        revokeMessageAttachmentObjectUrls(message);
      }
      const nextOverlay = { ...s.overlayMessagesByThread };
      delete nextOverlay[threadId];

      const nextStreaming: Record<string, ThreadToolCall | undefined> = {};
      for (const [id, tc] of Object.entries(s.streamingToolCallsById)) {
        if (!tc || tc.threadId === threadId) continue;
        nextStreaming[id] = tc;
      }

      return {
        overlayMessagesByThread: nextOverlay,
        streamingToolCallsById: nextStreaming,
        activeStreamByThread: { ...s.activeStreamByThread, [threadId]: false },
        currentStageByThread: { ...s.currentStageByThread, [threadId]: null },
      };
    }),

  clearAll: () =>
    set({
      threadsById: {},
      overlayMessagesByThread: {},
      streamingToolCallsById: {},
      preexistingLiveThreadsById: {},
      activeStreamByThread: {},
      currentStageByThread: {},
    }),
}));

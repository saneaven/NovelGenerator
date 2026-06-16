/**
 * Merge layer for the thread hybrid: combines the persisted snapshot (Query) with
 * the live overlay (`threadStreamStore`) into the exact shape consumers used to
 * read off the monolithic thread store. Consumers therefore change only their data
 * SOURCE, not their logic — all merge risk is concentrated here.
 *
 * Merge rule: the snapshot is finalized truth and WINS for any shared id; the
 * overlay contributes ids it alone holds (optimistic user msgs, the in-progress
 * streaming assistant msg, streaming temp tool calls).
 */

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { useShallow } from 'zustand/react/shallow';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import type { ThreadInfo, ThreadMessage, ThreadToolCall } from '../../types/thread';
import {
  buildThreadToolCallIndexes,
  buildMessageMap,
  buildToolCallIdsByMessageId,
  buildToolCallIdsByAssistantMessageId,
  buildPendingByThread,
  type ThreadToolCallIndexes,
} from '../../domain/threadToolCallIndexes';
import {
  threadMessagesQueryOptions,
  readThreadSnapshotFromCache,
  useThreadMessagesQuery,
} from './useThreadMessagesQuery';
import type { ThreadSnapshot } from './threadSnapshot';

export interface MergedThreadView extends ThreadToolCallIndexes {
  thread: ThreadInfo | undefined;
  messages: ThreadMessage[];
  currentStage: string | null;
  isStreamActive: boolean;
  isPreexistingLive: boolean;
  getToolCallsForAssistantMessage: (assistantMessageId: string) => ThreadToolCall[];
}

const EMPTY_MESSAGES: ThreadMessage[] = [];
const EMPTY_OVERLAY: ThreadMessage[] = [];

// ---- pure merge primitives -------------------------------------------------

export function mergeThreadMessages(snapshotMessages: ThreadMessage[], overlayMessages: ThreadMessage[]): ThreadMessage[] {
  if (overlayMessages.length === 0) {
    return snapshotMessages.length > 0 ? [...snapshotMessages].sort(bySeq) : EMPTY_MESSAGES;
  }
  const byId = new Map<string, ThreadMessage>();
  for (const m of overlayMessages) byId.set(m.id, m);
  for (const m of snapshotMessages) byId.set(m.id, m); // snapshot wins for shared ids
  return [...byId.values()].sort(bySeq);
}

export function mergeThreadToolCallsById(
  snapshotToolCalls: ThreadToolCall[],
  streamingToolCalls: ThreadToolCall[],
): Record<string, ThreadToolCall | undefined> {
  const byId: Record<string, ThreadToolCall | undefined> = {};
  for (const tc of streamingToolCalls) byId[tc.id] = tc;
  for (const tc of snapshotToolCalls) byId[tc.id] = tc; // snapshot wins
  return byId;
}

function bySeq(a: ThreadMessage, b: ThreadMessage): number {
  return a.seqInThread - b.seqInThread;
}

function buildView(
  thread: ThreadInfo | undefined,
  snapshot: ThreadSnapshot,
  overlayMessages: ThreadMessage[],
  streamingToolCalls: ThreadToolCall[],
  currentStage: string | null,
  isStreamActive: boolean,
  isPreexistingLive: boolean,
): MergedThreadView {
  const messages = mergeThreadMessages(snapshot.messages, overlayMessages);
  const toolCallsById = mergeThreadToolCallsById(snapshot.toolCalls, streamingToolCalls);
  const indexes = buildThreadToolCallIndexes(toolCallsById);
  return {
    thread,
    messages,
    ...indexes,
    currentStage,
    isStreamActive,
    isPreexistingLive,
    getToolCallsForAssistantMessage: (assistantMessageId: string) =>
      (indexes.toolCallIdsByAssistantMessageId[assistantMessageId] ?? [])
        .map((id) => indexes.toolCallsById[id])
        .filter((tc): tc is ThreadToolCall => Boolean(tc)),
  };
}

// ---- single-thread merged view ---------------------------------------------

export function useThreadView(threadId: string | null | undefined): MergedThreadView {
  const snapshotQuery = useThreadMessagesQuery(threadId);
  const snapshot = snapshotQuery.data ?? { messages: EMPTY_MESSAGES, toolCalls: [] };

  const thread = useThreadStreamStore((s) => (threadId ? s.threadsById[threadId] : undefined));
  const overlayMessages = useThreadStreamStore((s) => (threadId ? s.overlayMessagesByThread[threadId] ?? EMPTY_OVERLAY : EMPTY_OVERLAY));
  const currentStage = useThreadStreamStore((s) => (threadId ? s.currentStageByThread[threadId] ?? null : null));
  const isStreamActive = useThreadStreamStore((s) => (threadId ? Boolean(s.activeStreamByThread[threadId]) : false));
  const isPreexistingLive = useThreadStreamStore((s) => (threadId ? Boolean(s.preexistingLiveThreadsById[threadId]) : false));
  const streamingToolCalls = useThreadStreamStore(
    useShallow((s) => (threadId
      ? Object.values(s.streamingToolCallsById).filter((tc): tc is ThreadToolCall => tc != null && tc.threadId === threadId)
      : [])),
  );

  return useMemo(
    () => buildView(thread, snapshot, overlayMessages, streamingToolCalls, currentStage, isStreamActive, isPreexistingLive),
    [thread, snapshot, overlayMessages, streamingToolCalls, currentStage, isStreamActive, isPreexistingLive],
  );
}

/** Non-React merged view for imperative callers (commands, modal handlers). */
export function getMergedThreadView(threadId: string): MergedThreadView {
  const snapshot = readThreadSnapshotFromCache(threadId);
  const s = useThreadStreamStore.getState();
  const streamingToolCalls = Object.values(s.streamingToolCallsById)
    .filter((tc): tc is ThreadToolCall => tc != null && tc.threadId === threadId);
  return buildView(
    s.threadsById[threadId],
    snapshot,
    s.overlayMessagesByThread[threadId] ?? EMPTY_OVERLAY,
    streamingToolCalls,
    s.currentStageByThread[threadId] ?? null,
    Boolean(s.activeStreamByThread[threadId]),
    Boolean(s.preexistingLiveThreadsById[threadId]),
  );
}

export function getMergedThreadMessages(threadId: string): ThreadMessage[] {
  const snapshot = readThreadSnapshotFromCache(threadId);
  const overlay = useThreadStreamStore.getState().overlayMessagesByThread[threadId] ?? EMPTY_OVERLAY;
  return mergeThreadMessages(snapshot.messages, overlay);
}

// ---- bounded multi-thread merged maps (full-map consumers) -----------------

export interface MergedThreadMaps {
  messagesByThreadId: Record<string, ThreadMessage[] | undefined>;
  toolCallsById: Record<string, ThreadToolCall | undefined>;
  toolCallIdsByMessageId: Record<string, string[] | undefined>;
  toolCallIdsByAssistantMessageId: Record<string, string[] | undefined>;
  toolCallsByMessageId: Record<string, ThreadToolCall[] | undefined>;
  pendingToolCallIdsByThread: Record<string, string[] | undefined>;
}

/**
 * Merged maps for a bounded set of threads (AgentSidebar previews, SubAgentPeekDock
 * children). Reads the snapshot cache passively (no fetch) and overlays live state,
 * staying reactive to both. The active thread is fetched by its own ThreadMessageList.
 */
export function useMergedThreadMaps(threadIds: string[]): MergedThreadMaps {
  const uniqueIds = useMemo(() => [...new Set(threadIds.filter(Boolean))], [threadIds]);

  const snapshotResults = useQueries({
    queries: uniqueIds.map((id) => ({
      ...threadMessagesQueryOptions(id),
      enabled: false, // passive: read cache + stay reactive, never trigger a fetch here
    })),
  });

  const overlayByThread = useThreadStreamStore(
    useShallow((s) => uniqueIds.map((id) => s.overlayMessagesByThread[id] ?? EMPTY_OVERLAY)),
  );
  const streamingToolCalls = useThreadStreamStore(
    useShallow((s) => Object.values(s.streamingToolCallsById)
      .filter((tc): tc is ThreadToolCall => tc != null && uniqueIds.includes(tc.threadId))),
  );

  // Stable-size signature: changes when any thread's cached snapshot updates.
  const snapshotSig = snapshotResults.map((r) => r.dataUpdatedAt).join('|');

  return useMemo(() => {
    const messagesByThreadId: Record<string, ThreadMessage[] | undefined> = {};
    const toolCallsById: Record<string, ThreadToolCall | undefined> = {};

    uniqueIds.forEach((threadId, index) => {
      const snapshot: ThreadSnapshot = snapshotResults[index]?.data ?? { messages: EMPTY_MESSAGES, toolCalls: [] };
      const overlay = overlayByThread[index] ?? EMPTY_OVERLAY;
      messagesByThreadId[threadId] = mergeThreadMessages(snapshot.messages, overlay);
      for (const tc of snapshot.toolCalls) toolCallsById[tc.id] = tc;
    });

    for (const tc of streamingToolCalls) {
      if (!toolCallsById[tc.id]) toolCallsById[tc.id] = tc; // snapshot already won above
    }

    return {
      messagesByThreadId,
      toolCallsById,
      toolCallIdsByMessageId: buildToolCallIdsByMessageId(toolCallsById),
      toolCallIdsByAssistantMessageId: buildToolCallIdsByAssistantMessageId(toolCallsById),
      toolCallsByMessageId: buildMessageMap(toolCallsById),
      pendingToolCallIdsByThread: buildPendingByThread(toolCallsById),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueIds, overlayByThread, streamingToolCalls, snapshotSig]);
}

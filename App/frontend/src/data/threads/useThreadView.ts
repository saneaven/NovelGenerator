/**
 * Read layer for the thread snapshot. The TanStack Query cache is the single
 * source of truth — finalized rows AND in-progress streaming/optimistic/temp
 * rows all live there. This module only sorts + indexes it; there is no overlay
 * merge, so the whole class of overlay-vs-snapshot races is gone.
 */

import { useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
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
  bySeq,
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
const EMPTY_SNAPSHOT: ThreadSnapshot = { messages: EMPTY_MESSAGES, toolCalls: [] };

// ---- pure primitives -------------------------------------------------------

export function sortThreadMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return messages.length > 0 ? [...messages].sort(bySeq) : EMPTY_MESSAGES;
}

function toolCallsById(toolCalls: ThreadToolCall[]): Record<string, ThreadToolCall | undefined> {
  const byId: Record<string, ThreadToolCall | undefined> = {};
  for (const tc of toolCalls) byId[tc.id] = tc;
  return byId;
}

function buildView(
  thread: ThreadInfo | undefined,
  snapshot: ThreadSnapshot,
  currentStage: string | null,
  isStreamActive: boolean,
  isPreexistingLive: boolean,
): MergedThreadView {
  const messages = sortThreadMessages(snapshot.messages);
  const indexes = buildThreadToolCallIndexes(toolCallsById(snapshot.toolCalls));
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

// ---- single-thread view ----------------------------------------------------

export function useThreadView(threadId: string | null | undefined): MergedThreadView {
  const snapshotQuery = useThreadMessagesQuery(threadId);
  const snapshot = snapshotQuery.data ?? EMPTY_SNAPSHOT;

  const thread = useThreadStreamStore((s) => (threadId ? s.threadsById[threadId] : undefined));
  const currentStage = useThreadStreamStore((s) => (threadId ? s.currentStageByThread[threadId] ?? null : null));
  const isStreamActive = useThreadStreamStore((s) => (threadId ? Boolean(s.activeStreamByThread[threadId]) : false));
  const isPreexistingLive = useThreadStreamStore((s) => (threadId ? Boolean(s.preexistingLiveThreadsById[threadId]) : false));

  return useMemo(
    () => buildView(thread, snapshot, currentStage, isStreamActive, isPreexistingLive),
    [thread, snapshot, currentStage, isStreamActive, isPreexistingLive],
  );
}

/** Non-React view for imperative callers (commands, modal handlers). */
export function getMergedThreadView(threadId: string): MergedThreadView {
  const s = useThreadStreamStore.getState();
  return buildView(
    s.threadsById[threadId],
    readThreadSnapshotFromCache(threadId),
    s.currentStageByThread[threadId] ?? null,
    Boolean(s.activeStreamByThread[threadId]),
    Boolean(s.preexistingLiveThreadsById[threadId]),
  );
}

export function getMergedThreadMessages(threadId: string): ThreadMessage[] {
  return sortThreadMessages(readThreadSnapshotFromCache(threadId).messages);
}

// ---- bounded multi-thread maps (full-map consumers) ------------------------

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
 * children). Reads the snapshot cache passively (no fetch) and stays reactive to it.
 */
export function useMergedThreadMaps(threadIds: string[]): MergedThreadMaps {
  const uniqueIds = useMemo(() => [...new Set(threadIds.filter(Boolean))], [threadIds]);

  const snapshotResults = useQueries({
    queries: uniqueIds.map((id) => ({
      ...threadMessagesQueryOptions(id),
      enabled: false, // passive: read cache + stay reactive, never trigger a fetch here
    })),
  });

  // Stable-size signature: changes when any thread's cached snapshot updates.
  const snapshotSig = snapshotResults.map((r) => r.dataUpdatedAt).join('|');

  return useMemo(() => {
    const messagesByThreadId: Record<string, ThreadMessage[] | undefined> = {};
    const byId: Record<string, ThreadToolCall | undefined> = {};

    uniqueIds.forEach((threadId, index) => {
      const snapshot: ThreadSnapshot = snapshotResults[index]?.data ?? EMPTY_SNAPSHOT;
      messagesByThreadId[threadId] = sortThreadMessages(snapshot.messages);
      for (const tc of snapshot.toolCalls) byId[tc.id] = tc;
    });

    return {
      messagesByThreadId,
      toolCallsById: byId,
      toolCallIdsByMessageId: buildToolCallIdsByMessageId(byId),
      toolCallIdsByAssistantMessageId: buildToolCallIdsByAssistantMessageId(byId),
      toolCallsByMessageId: buildMessageMap(byId),
      pendingToolCallIdsByThread: buildPendingByThread(byId),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uniqueIds, snapshotSig]);
}

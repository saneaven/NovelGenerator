/**
 * TanStack Query cache for persisted messages, tool calls and live deltas.
 *
 * - The query caches a `ThreadSnapshot` under `threadKeys.messages(threadId)`.
 * - A consistent server snapshot restores metadata and the active stream prefix.
 * - Events arriving during the fetch are buffered and replayed after its cursor.
 * - SSE and optimistic edits write through the imperative cache mutators below.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryClient } from '../queryClient';
import { threadKeys } from '../keys/threadKeys';
import { threadService } from '../../api/threadService';
import { seedImageRunsInCache } from '../imageRuns';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import type { ThreadMessage, ThreadToolCall } from '../../types/thread';
import { toLatestRunContext, toThreadSnapshot, type ThreadSnapshot } from './threadSnapshot';
import { beginThreadSnapshot, reconciliationGeneration, threadCursor, takeThreadSnapshotEvents } from '../../runtime/threadReconciliation';

const EMPTY_SNAPSHOT: ThreadSnapshot = { messages: [], toolCalls: [] };

/** Stable order: seqInThread, then createdAt, then id — no ties left to chance. */
export function bySeq(a: ThreadMessage, b: ThreadMessage): number {
  if (a.seqInThread !== b.seqInThread) return a.seqInThread - b.seqInThread;
  if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
  return a.id.localeCompare(b.id);
}

function sortMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return [...messages].sort(bySeq);
}

/**
 * Restore runtime metadata at the snapshot cursor. Buffered newer events are
 * applied immediately afterward, including latest-run journey context.
 */
function applyThreadSnapshotSideEffects(threadId: string, response: Awaited<ReturnType<typeof threadService.listMessages>>): void {
  const store = useThreadStreamStore.getState();
  seedImageRunsInCache(response.imageRuns);
  const existing = store.threadsById[threadId];
  const latestRunContext = toLatestRunContext(response.latestRun);
  if (!existing) {
    store.upsertThread({
      ...response.thread,
      latestRunId: response.latestRun?.id ?? null,
      latestRunSeq: response.latestRun?.runSeq ?? null,
      latestRunUpdatedAt: response.latestRun?.updatedAt ?? null,
      latestRunContext,
    });
    store.setThreadStreamActive(threadId, response.messages.some((message) => message.isStreaming));
    return;
  }
  store.patchThread(threadId, {
    ...response.thread,
    latestRunId: response.latestRun?.id ?? null,
    latestRunStatus: response.latestRun?.status ?? null,
    latestRunSeq: response.latestRun?.runSeq ?? null,
    latestRunUpdatedAt: response.latestRun?.updatedAt ?? null,
    latestRunContext,
  });
  store.setThreadStreamActive(threadId, response.messages.some((message) => message.isStreaming));
}

export function threadMessagesQueryOptions(threadId: string) {
  return {
    queryKey: threadKeys.messages(threadId),
    queryFn: async (): Promise<ThreadSnapshot> => {
      const generation = reconciliationGeneration();
      beginThreadSnapshot(threadId);
      const { getThreadEventConsumer } = await import('../../runtime/consumers/threadEventConsumer');
      const consumer = getThreadEventConsumer();
      try {
        const response = await threadService.listMessages(threadId);
        if (generation !== reconciliationGeneration()) {
          throw new Error('Runtime stream reset during snapshot restoration');
        }
        applyThreadSnapshotSideEffects(threadId, response);
        queryClient.setQueryData(threadKeys.messages(threadId), { ...toThreadSnapshot(response), generation });
        consumer.restoreSnapshot(threadId, response.streamEvents ?? [], response.snapshotEventId);
        return { ...readThreadSnapshotFromCache(threadId), version: threadCursor(threadId) };
      } catch (error) {
        if (generation === reconciliationGeneration()) {
          for (const event of takeThreadSnapshotEvents(threadId)) consumer.consume(event);
        }
        throw error;
      }
    },
    structuralSharing: (previous: unknown, next: unknown) => {
      const prev = previous as ThreadSnapshot | undefined;
      const value = next as ThreadSnapshot;
      if ((prev?.generation ?? 0) !== (value.generation ?? 0)) {
        return (prev?.generation ?? 0) > (value.generation ?? 0) ? previous : next;
      }
      return (prev?.version ?? 0) > (value.version ?? 0) ? previous : next;
    },
    // SSE-driven invalidation is the freshness source; never staleness-refetch.
    staleTime: Infinity,
    // Never GC a background thread streaming with no mounted observer.
    gcTime: Infinity,
  };
}

export function useThreadMessagesQuery(
  threadId: string | null | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<ThreadSnapshot> {
  return useQuery({
    ...threadMessagesQueryOptions(threadId ?? '__none__'),
    enabled: Boolean(threadId) && (options?.enabled ?? true),
  });
}

// ---- non-React cache access ------------------------------------------------

export function readThreadSnapshotFromCache(threadId: string): ThreadSnapshot {
  return queryClient.getQueryData<ThreadSnapshot>(threadKeys.messages(threadId)) ?? EMPTY_SNAPSHOT;
}

/** Ensure the snapshot is loaded (returns cached value when fresh; dedups in-flight). */
export function fetchThreadSnapshot(threadId: string): Promise<ThreadSnapshot> {
  return queryClient.fetchQuery(threadMessagesQueryOptions(threadId));
}

/** Force a fresh re-fetch and re-apply (replaces the old `fetchAndReplaceThreadSnapshot`). */
export function refetchThreadSnapshot(threadId: string): Promise<ThreadSnapshot> {
  if (!threadId) return Promise.resolve(EMPTY_SNAPSHOT);
  return queryClient.fetchQuery({ ...threadMessagesQueryOptions(threadId), staleTime: 0 });
}

export function invalidateThreadMessages(threadId: string): void {
  void queryClient.invalidateQueries({ queryKey: threadKeys.messages(threadId) });
}

export function removeThreadSnapshotFromCache(threadId: string): void {
  queryClient.removeQueries({ queryKey: threadKeys.messages(threadId), exact: true });
}

// ---- imperative cache mutators (finalized truth) ---------------------------

function writeSnapshot(threadId: string, recipe: (prev: ThreadSnapshot) => ThreadSnapshot): void {
  queryClient.setQueryData<ThreadSnapshot>(threadKeys.messages(threadId), (prev) =>
    ({ ...recipe(prev ?? EMPTY_SNAPSHOT), version: threadCursor(threadId), generation: reconciliationGeneration() }),
  );
}

export function upsertSnapshotMessage(message: ThreadMessage): void {
  writeSnapshot(message.threadId, (prev) => {
    const index = prev.messages.findIndex((m) => m.id === message.id);
    const messages = index < 0
      ? [...prev.messages, message]
      : prev.messages.map((m) => (m.id === message.id ? { ...m, ...message } : m));
    return { ...prev, messages: sortMessages(messages) };
  });
}

export function upsertSnapshotMessages(messages: ThreadMessage[]): void {
  const byThread = new Map<string, ThreadMessage[]>();
  for (const message of messages) {
    const list = byThread.get(message.threadId) ?? [];
    list.push(message);
    byThread.set(message.threadId, list);
  }
  for (const [threadId, list] of byThread) {
    writeSnapshot(threadId, (prev) => {
      const next = [...prev.messages];
      for (const message of list) {
        const index = next.findIndex((m) => m.id === message.id);
        if (index < 0) next.push(message);
        else next[index] = { ...next[index], ...message };
      }
      return { ...prev, messages: sortMessages(next) };
    });
  }
}

export function patchSnapshotMessage(threadId: string, messageId: string, partial: Partial<ThreadMessage>): void {
  writeSnapshot(threadId, (prev) => ({
    ...prev,
    messages: prev.messages.map((m) => (m.id === messageId ? { ...m, ...partial } : m)),
  }));
}

export function removeSnapshotMessage(threadId: string, messageId: string): void {
  writeSnapshot(threadId, (prev) => ({
    ...prev,
    messages: prev.messages.filter((m) => m.id !== messageId),
  }));
}

export function upsertSnapshotToolCall(toolCall: ThreadToolCall): void {
  writeSnapshot(toolCall.threadId, (prev) => {
    const index = prev.toolCalls.findIndex((tc) => tc.id === toolCall.id);
    const toolCalls = index < 0
      ? [...prev.toolCalls, toolCall]
      : prev.toolCalls.map((tc) => (tc.id === toolCall.id ? toolCall : tc));
    return { ...prev, toolCalls };
  });
}

export function patchSnapshotToolCall(threadId: string, toolCallId: string, partial: Partial<ThreadToolCall>): void {
  writeSnapshot(threadId, (prev) => ({
    ...prev,
    toolCalls: prev.toolCalls.map((tc) => (tc.id === toolCallId ? { ...tc, ...partial } : tc)),
  }));
}

export function removeSnapshotToolCall(threadId: string, toolCallId: string): void {
  writeSnapshot(threadId, (prev) => ({
    ...prev,
    toolCalls: prev.toolCalls.filter((tc) => tc.id !== toolCallId),
  }));
}

/** message:end — replace ALL tool calls bound to an assistant message with the authoritative set. */
export function replaceSnapshotToolCallsForAssistant(
  threadId: string,
  assistantMessageId: string,
  newToolCalls: ThreadToolCall[],
): void {
  writeSnapshot(threadId, (prev) => {
    const kept = prev.toolCalls.filter((tc) => tc.assistantMessageId !== assistantMessageId);
    return { ...prev, toolCalls: [...kept, ...newToolCalls] };
  });
}

/** Resolve the streaming assistant row for delta application; null if already finalized. */
export function ensureStreamingMessageInCache(threadId: string, messageId: string, runId: string): ThreadMessage | null {
  const messages = readThreadSnapshotFromCache(threadId).messages;
  const existing = messages.find((m) => m.id === messageId);
  if (existing) return existing.isStreaming ? existing : null;
  const maxSeq = messages.reduce((max, m) => Math.max(max, m.seqInThread), 0);
  const created: ThreadMessage = {
    id: messageId,
    threadId,
    runId,
    role: 'assistant',
    seq: 0,
    seqInThread: maxSeq + 1,
    data: {},
    attachments: [],
    streamingData: { contentParts: [] },
    isStreaming: true,
    createdAt: new Date().toISOString(),
  };
  upsertSnapshotMessage(created);
  return created;
}

/** Drop leftover streaming rows + temp tool calls for a thread (cancel/suppress). */
export function clearThreadStreamingCache(threadId: string): void {
  writeSnapshot(threadId, (prev) => ({
    ...prev,
    messages: prev.messages.filter((m) => !m.isStreaming),
    toolCalls: prev.toolCalls.filter((tc) => tc.status !== 'streaming' && !tc.id.startsWith('streaming:')),
  }));
}

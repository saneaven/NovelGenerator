/**
 * TanStack Query layer for the persisted thread snapshot (finalized messages +
 * tool calls). The live overlay lives in `threadStreamStore`; the two are merged
 * by `useThreadView`.
 *
 * - The query caches a `ThreadSnapshot` under `threadKeys.messages(threadId)`.
 * - Fetching seeds thread metadata when absent and latest-run context from the
 *   snapshot, plus image runs as a side effect.
 * - SSE-finalized events and optimistic edits write through the imperative cache
 *   mutators below (never token deltas — those go to the overlay store).
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { queryClient } from '../queryClient';
import { threadKeys } from '../keys/threadKeys';
import { threadService } from '../../api/threadService';
import { seedImageRunsInCache } from '../imageRuns';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import type { ThreadMessage, ThreadToolCall } from '../../types/thread';
import { toLatestRunContext, toThreadSnapshot, type ThreadSnapshot } from './threadSnapshot';

const EMPTY_SNAPSHOT: ThreadSnapshot = { messages: [], toolCalls: [] };

function sortMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return [...messages].sort((a, b) => a.seqInThread - b.seqInThread);
}

/**
 * Seed thread metadata only for a cold thread. Existing thread runtime status
 * stays live-owned, but the snapshot is the source of truth for latest-run
 * context used by follow-up journey feedback.
 */
function applyThreadSnapshotSideEffects(threadId: string, response: Awaited<ReturnType<typeof threadService.listMessages>>): void {
  const store = useThreadStreamStore.getState();
  seedImageRunsInCache(response.imageRuns);
  const existing = store.threadsById[threadId];
  const latestRunContext = toLatestRunContext(response.latestRun);
  if (!existing) {
    store.upsertThread({
      ...response.thread,
      latestRunContext,
    });
    return;
  }
  store.patchThread(threadId, { latestRunContext });
}

export function threadMessagesQueryOptions(threadId: string) {
  return {
    queryKey: threadKeys.messages(threadId),
    queryFn: async (): Promise<ThreadSnapshot> => {
      const response = await threadService.listMessages(threadId);
      applyThreadSnapshotSideEffects(threadId, response);
      return toThreadSnapshot(response);
    },
    // Freshness is driven by SSE-driven invalidation, not staleness polling, so a
    // remount never refetches mid-stream and clobbers the live overlay.
    staleTime: Infinity,
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
    recipe(prev ?? EMPTY_SNAPSHOT),
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

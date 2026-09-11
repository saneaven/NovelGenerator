/**
 * Pure shaping of a `listMessages` response into the persisted thread snapshot
 * (the part that lives in the TanStack Query cache) plus the live thread-metadata
 * fields that seed `threadStreamStore`.
 *
 * No React / no Zustand / no queryClient — just transforms.
 */

import type { ThreadMessagesResponse } from '../../api/threadService';
import type { LatestRunContext, ThreadInfo } from '../../types/thread';

/** The persisted content cached under `threadKeys.messages(threadId)`. */
export interface ThreadSnapshot {
  messages: ThreadMessagesResponse['messages'];
  toolCalls: ThreadMessagesResponse['toolCalls'];
}

const UNRESOLVED_TOOL_CALL_STATUSES = new Set(['streaming', 'validating', 'pending', 'processing', 'working']);

export function toThreadSnapshot(response: ThreadMessagesResponse): ThreadSnapshot {
  return {
    messages: response.messages,
    toolCalls: response.toolCalls,
  };
}

export function toLatestRunContext(
  responseLatestRun: ThreadMessagesResponse['latestRun'],
): LatestRunContext | null {
  if (!responseLatestRun) return null;
  return {
    inputPayload: responseLatestRun.inputPayload,
    contextObjectIds: responseLatestRun.contextObjectIds,
    journeyTargetIds: responseLatestRun.journeyTargetIds,
    language: responseLatestRun.language,
    runMode: responseLatestRun.runMode,
    surface: responseLatestRun.surface,
  };
}

/**
 * The live thread-metadata fields derived from a snapshot response. These seed
 * `threadStreamStore.threadsById` (status/error live there, not in the query cache).
 */
export function toThreadRuntimeFromSnapshot(response: ThreadMessagesResponse): Partial<ThreadInfo> {
  const latestMessage = response.messages.length > 0
    ? [...response.messages].sort((a, b) => a.seqInThread - b.seqInThread)[response.messages.length - 1]
    : null;
  const unresolvedToolCallCount = response.toolCalls.filter(
    (toolCall) => UNRESOLVED_TOOL_CALL_STATUSES.has(toolCall.status),
  ).length;

  return {
    unresolvedToolCallCount,
    latestMessageAt: latestMessage?.createdAt ?? null,
    updatedAt: response.thread.updatedAt ?? latestMessage?.createdAt ?? null,
    latestRunContext: toLatestRunContext(response.latestRun),
  };
}

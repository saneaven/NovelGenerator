import { threadService, type ThreadMessagesResponse } from '../api/threadService';
import { useImageRunStore } from '../imageRun';
import { useThreadStore } from '../store/threadStore';
import type { LatestRunContext } from '../types/thread';
import { isNonLiveThreadStatus } from './threadStreamLifecycle';

const inFlightThreadSnapshotRefresh = new Set<string>();
const UNRESOLVED_TOOL_CALL_STATUSES = new Set(['streaming', 'validating', 'pending', 'processing', 'working']);

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

export function applyThreadSnapshot(response: ThreadMessagesResponse): void {
  const store = useThreadStore.getState();
  const threadId = response.thread.id;
  const latestMessage = response.messages.length > 0
    ? [...response.messages].sort((a, b) => a.seqInThread - b.seqInThread)[response.messages.length - 1]
    : null;
  const unresolvedToolCallCount = response.toolCalls.filter((toolCall) => UNRESOLVED_TOOL_CALL_STATUSES.has(toolCall.status)).length;

  store.upsertThread(response.thread);
  store.replaceThreadMessages(threadId, response.messages);
  store.replaceThreadToolCalls(threadId, response.toolCalls);
  useImageRunStore.getState().upsertRuns(response.imageRuns);
  store.setThreadStreamActive(threadId, false);
  store.setThreadRuntime(threadId, {
    unresolvedToolCallCount,
    latestMessageAt: latestMessage?.createdAt ?? null,
    updatedAt: response.thread.updatedAt ?? latestMessage?.createdAt ?? null,
    latestRunContext: toLatestRunContext(response.latestRun),
  });

  if (isNonLiveThreadStatus(response.thread.status)) {
    store.clearPreexistingLiveThread(threadId);
  }
}

export async function fetchAndReplaceThreadSnapshot(threadId: string): Promise<void> {
  if (!threadId || inFlightThreadSnapshotRefresh.has(threadId)) return;
  inFlightThreadSnapshotRefresh.add(threadId);

  try {
    const response = await threadService.listMessages(threadId);
    applyThreadSnapshot(response);
  } finally {
    inFlightThreadSnapshotRefresh.delete(threadId);
  }
}

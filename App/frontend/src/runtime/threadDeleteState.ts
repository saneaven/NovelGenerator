import { useThreadStore } from '../store/threadStore';
import { nowIso, type ThreadInfo, type ThreadStatus, type ToolCallStatus } from '../types/thread';

const UNRESOLVED_TOOL_CALL_STATUSES = new Set<ToolCallStatus>([
  'streaming',
  'validating',
  'pending',
  'processing',
  'working',
]);

const DELETE_PAUSE_SOURCE_STATUSES = new Set<ThreadStatus>(['waiting', 'processing']);

export interface ThreadDeletePauseContext {
  previousThreadStatus?: ThreadStatus;
  previousUnresolvedCount: number;
}

export function countUnresolvedToolCallsForThread(threadId: string): number {
  const state = useThreadStore.getState();
  let count = 0;

  for (const toolCall of Object.values(state.toolCallsById)) {
    if (!toolCall || toolCall.threadId !== threadId) continue;
    if (!UNRESOLVED_TOOL_CALL_STATUSES.has(toolCall.status)) continue;
    count += 1;
  }

  return count;
}

export function getThreadDeletePauseContext(threadId: string): ThreadDeletePauseContext {
  const state = useThreadStore.getState();
  return {
    previousThreadStatus: state.threadsById[threadId]?.status,
    previousUnresolvedCount: countUnresolvedToolCallsForThread(threadId),
  };
}

export function applyOptimisticDeletePause(
  threadId: string,
  context: ThreadDeletePauseContext,
): void {
  const state = useThreadStore.getState();
  const nextUnresolvedCount = countUnresolvedToolCallsForThread(threadId);
  const partial: Partial<ThreadInfo> = {
    unresolvedToolCallCount: nextUnresolvedCount,
    updatedAt: nowIso(),
  };

  if (
    context.previousUnresolvedCount > 0
    && nextUnresolvedCount === 0
    && context.previousThreadStatus
    && DELETE_PAUSE_SOURCE_STATUSES.has(context.previousThreadStatus)
  ) {
    partial.status = 'paused';
    partial.latestRunStatus = 'paused';
  }

  state.setThreadRuntime(threadId, partial);
}

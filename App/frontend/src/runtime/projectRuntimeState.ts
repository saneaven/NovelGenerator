import { threadService, type ProjectThreadRuntimeItem } from '../api/threadService';
import { useThreadStreamStore } from '../store/threadStreamStore';
import { refetchThreadSnapshot } from '../data/threads';
import { isNonLiveThreadStatus } from './threadStreamLifecycle';

export async function hydrateProjectRuntimeSummary(projectId: string): Promise<ProjectThreadRuntimeItem[]> {
  const rows = await threadService.listProjectThreadRuntime(projectId);
  useThreadStreamStore.getState().upsertThreadsRuntime(rows);
  return rows;
}

export async function reconcilePreexistingLiveThreads(
  projectId: string,
  runtimeRows?: ProjectThreadRuntimeItem[],
): Promise<void> {
  const rows = runtimeRows ?? await hydrateProjectRuntimeSummary(projectId);
  const state = useThreadStreamStore.getState();
  const completedRows = rows.filter((row) => state.isPreexistingLiveThread(row.id) && isNonLiveThreadStatus(row.status));

  await Promise.allSettled(completedRows.map((row) => refetchThreadSnapshot(row.id)));
}

export function suppressRunningThreadStreaming(projectId: string): string[] {
  const state = useThreadStreamStore.getState();
  const threadIds = Object.values(state.threadsById)
    .filter((thread) => thread?.projectId === projectId && thread.status === 'running')
    .map((thread) => thread!.id);

  if (threadIds.length === 0) {
    return [];
  }

  state.markPreexistingLiveThreads(threadIds);
  for (const threadId of threadIds) {
    state.clearThreadStreamingState(threadId);
  }
  return threadIds;
}

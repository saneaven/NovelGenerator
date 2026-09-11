import { threadService, type ProjectThreadRuntimeItem } from '../api/threadService';
import { useThreadStreamStore } from '../store/threadStreamStore';
import { refetchThreadSnapshot } from '../data/threads';
import { queryClient } from '../data/queryClient';

export async function hydrateProjectRuntimeSummary(projectId: string): Promise<ProjectThreadRuntimeItem[]> {
  const rows = await threadService.listProjectThreadRuntime(projectId);
  useThreadStreamStore.getState().upsertThreadsRuntime(rows);
  return rows;
}

export async function reconcilePreexistingLiveThreads(
  projectId: string | null,
  runtimeRows?: ProjectThreadRuntimeItem[],
): Promise<void> {
  const rows = runtimeRows ?? (projectId ? await hydrateProjectRuntimeSummary(projectId) : []);
  const state = useThreadStreamStore.getState();
  const ids = new Set(rows.filter((row) => state.isPreexistingLiveThread(row.id)
    || row.status === 'running' || row.status === 'processing' || row.status === 'waiting')
    .map((row) => row.id));
  // A cached conversation in another project can also have advanced while this
  // tab slept. Refetch it now instead of leaving an infinitely fresh stale row.
  for (const query of queryClient.getQueryCache().findAll({ queryKey: ['threads', 'messages'] })) {
    const id = query.queryKey[2];
    if (typeof id === 'string') ids.add(id);
  }
  await Promise.all([...ids].map((id) => refetchThreadSnapshot(id)));
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

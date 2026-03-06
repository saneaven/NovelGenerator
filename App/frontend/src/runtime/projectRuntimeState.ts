import { threadService, type ProjectThreadRuntimeItem } from '../api/threadService';
import { useThreadStore } from '../store/threadStore';
import { fetchAndReplaceThreadSnapshot } from './threadHydration';
import { isNonLiveThreadStatus } from './threadStreamLifecycle';

export async function hydrateProjectRuntimeSummary(projectId: string): Promise<ProjectThreadRuntimeItem[]> {
  const rows = await threadService.listProjectThreadRuntime(projectId);
  useThreadStore.getState().upsertThreadsRuntime(rows);
  return rows;
}

export async function reconcilePreexistingLiveThreads(
  projectId: string,
  runtimeRows?: ProjectThreadRuntimeItem[],
): Promise<void> {
  const rows = runtimeRows ?? await hydrateProjectRuntimeSummary(projectId);
  const state = useThreadStore.getState();
  const completedRows = rows.filter((row) => state.isPreexistingLiveThread(row.id) && isNonLiveThreadStatus(row.status));

  for (const row of completedRows) {
    await fetchAndReplaceThreadSnapshot(row.id);
  }
}

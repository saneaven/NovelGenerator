import { invalidateProjectAssetQueries } from '../data/assets';
import { useThreadStreamStore } from '../store/threadStreamStore';
import { hydrateProjectRuntimeSummary, reconcilePreexistingLiveThreads } from './projectRuntimeState';
import { shouldMarkAsPreexistingLive } from './threadStreamLifecycle';

const coldBootInitializedProjects = new Set<string>();

export async function bootstrapProjectRuntime(projectId: string): Promise<void> {
  const firstBootForProject = !coldBootInitializedProjects.has(projectId);
  const runtimeRows = await hydrateProjectRuntimeSummary(projectId);

  if (firstBootForProject) {
    coldBootInitializedProjects.add(projectId);
    const preexistingIds = runtimeRows
      .filter((row) => shouldMarkAsPreexistingLive(row.status))
      .map((row) => row.id);
    useThreadStreamStore.getState().markPreexistingLiveThreads(preexistingIds);
  }

  invalidateProjectAssetQueries(projectId);
  await reconcilePreexistingLiveThreads(projectId, runtimeRows);
}

import { useAssetStore } from '../store/assetStore';
import { useThreadStore } from '../store/threadStore';
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
    useThreadStore.getState().markPreexistingLiveThreads(preexistingIds);
  }

  await useAssetStore.getState().refreshLoadedCaches(projectId);
  await reconcilePreexistingLiveThreads(projectId, runtimeRows);
}

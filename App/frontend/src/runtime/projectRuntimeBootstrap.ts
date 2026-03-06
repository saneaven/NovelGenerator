import { startProjectRuntime } from './runtimeStream';
import { useThreadStore } from '../store/threadStore';
import { hydrateProjectRuntimeSummary, reconcilePreexistingLiveThreads } from './projectRuntimeState';
import { shouldMarkAsPreexistingLive } from './threadStreamLifecycle';

const coldBootInitializedProjects = new Set<string>();

export async function bootstrapProjectRuntime(projectId: string): Promise<void> {
  const firstBootForProject = !coldBootInitializedProjects.has(projectId);
  let runtimeRows;

  try {
    runtimeRows = await hydrateProjectRuntimeSummary(projectId);

    if (firstBootForProject) {
      coldBootInitializedProjects.add(projectId);
      const preexistingIds = runtimeRows
        .filter((row) => shouldMarkAsPreexistingLive(row.status))
        .map((row) => row.id);
      useThreadStore.getState().markPreexistingLiveThreads(preexistingIds);
    }
  } catch (error) {
    await startProjectRuntime(projectId);
    throw error;
  }

  await startProjectRuntime(projectId);
  await reconcilePreexistingLiveThreads(projectId, runtimeRows);
}

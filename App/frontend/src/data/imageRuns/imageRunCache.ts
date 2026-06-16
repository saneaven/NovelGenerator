/**
 * Non-React writers for the per-project image-run cache.
 *
 * All image-run updates (create/cancel/decide responses, SSE pushes, thread and
 * runtime hydration) flow through here via `setQueryData` so the map keyed under
 * each project accumulates and is never dropped by a refetch.
 */

import { queryClient } from '../queryClient';
import { imageRunKeys } from '../keys/imageRunKeys';
import type { ImageRun } from '../../api/assetService';
import type { ImageRunMap } from './useImageRunsQuery';

/** Insert or replace a single run in its project's map. */
export function upsertImageRunInCache(run: ImageRun): void {
  queryClient.setQueryData<ImageRunMap>(imageRunKeys.map(run.project_id), (prev) => ({
    ...(prev ?? {}),
    [run.id]: run,
  }));
}

/**
 * Merge a batch of runs into their per-project maps, grouped by `project_id`.
 * Used by thread hydration + runtime rehydration; derives the project per run.
 */
export function seedImageRunsInCache(runs: ImageRun[]): void {
  if (runs.length === 0) return;
  const byProject = new Map<string, ImageRun[]>();
  for (const run of runs) {
    const group = byProject.get(run.project_id);
    if (group) group.push(run);
    else byProject.set(run.project_id, [run]);
  }
  for (const [projectId, group] of byProject) {
    queryClient.setQueryData<ImageRunMap>(imageRunKeys.map(projectId), (prev) => {
      const next: ImageRunMap = { ...(prev ?? {}) };
      for (const run of group) next[run.id] = run;
      return next;
    });
  }
}

/** Drop a single run from a project's map (no-op if absent). */
export function removeImageRunFromCache(projectId: string, runId: string): void {
  queryClient.setQueryData<ImageRunMap>(imageRunKeys.map(projectId), (prev) => {
    if (!prev || !(runId in prev)) return prev;
    const next = { ...prev };
    delete next[runId];
    return next;
  });
}

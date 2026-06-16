/**
 * Query for the per-project image-run map (`Record<string, ImageRun>`).
 *
 * The cache accumulates and never drops runs except by explicit removal: the
 * queryFn fetches the INITIAL active runs and MERGES them into whatever is
 * already cached, so runs seeded via `setQueryData` (SSE updates, thread/runtime
 * hydration) are never clobbered by a refetch. `staleTime: Infinity` means a
 * single fetch per project serves every consumer; all subsequent updates flow
 * through `setQueryData` (see `imageRunCache.ts`), never invalidation.
 */

import { useQuery } from '@tanstack/react-query';
import { assetService, type ImageRun } from '../../api/assetService';
import { imageRunKeys } from '../keys/imageRunKeys';
import { queryClient } from '../queryClient';

export type ImageRunMap = Record<string, ImageRun>;

const EMPTY: ImageRunMap = {};

/**
 * Shared query options, so non-React callers (e.g. `queryClient.fetchQuery`)
 * fetch with the exact same key, fetcher, and freshness as the hook.
 */
export function imageRunsQueryOptions(projectId: string) {
  return {
    queryKey: imageRunKeys.map(projectId),
    queryFn: async (): Promise<ImageRunMap> => {
      const key = imageRunKeys.map(projectId);
      const existing = queryClient.getQueryData<ImageRunMap>(key) ?? {};
      const active = await assetService.listImageRuns(projectId, 'active');
      const next: ImageRunMap = { ...existing };
      for (const run of active) next[run.id] = run;
      return next;
    },
    staleTime: Infinity,
  };
}

/** Subscribe to the per-project image-run map (disabled until a project is set). */
export function useImageRunsQuery(projectId: string | null | undefined) {
  return useQuery({
    ...imageRunsQueryOptions(projectId ?? '__none__'),
    enabled: Boolean(projectId),
  });
}

/** Reactive id → run map for a project (empty object until loaded). */
export function useImageRunsMap(projectId: string | null | undefined): ImageRunMap {
  return useImageRunsQuery(projectId).data ?? EMPTY;
}

/** A single image run by id, reactively. */
export function useImageRun(
  projectId: string | null | undefined,
  runId: string | null | undefined,
): ImageRun | undefined {
  const map = useImageRunsMap(projectId);
  return runId ? map[runId] : undefined;
}

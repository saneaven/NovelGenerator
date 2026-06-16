/**
 * Non-React asset cache invalidation for the SSE bridge and runtime rehydration.
 *
 * Replaces the old assetStore.refreshLoadedCaches + the per-scope
 * fetch*(force:true) calls. TanStack invalidation refetches *active* (mounted)
 * queries and marks the rest stale, which reproduces the old store's "only
 * refresh what's already loaded" behavior without a manual loaded-flag registry.
 */

import { queryClient } from '../queryClient';
import { assetKeys } from '../keys/assetKeys';

/**
 * Every asset query for one project, regardless of scope (project / object links
 * / scene). `assetKeys` interleaves the projectId at scope-specific positions,
 * so match by the shared `['assets', ...]` root plus a projectId hit anywhere in
 * the key.
 */
export function invalidateProjectAssetQueries(projectId: string): void {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return (
        Array.isArray(key)
        && key[0] === assetKeys.all[0]
        && key.includes(projectId)
      );
    },
  });
}

/** All assets for a project (old: fetchAssets(force:true)). */
export function invalidateProjectAssetsList(projectId: string): void {
  void queryClient.invalidateQueries({ queryKey: assetKeys.projectAssets(projectId) });
}

/** One object's links (old: fetchObjectAssetLinks(force:true)). */
export function invalidateObjectAssetLinks(
  projectId: string,
  objectType: string,
  objectId: string,
): void {
  void queryClient.invalidateQueries({
    queryKey: assetKeys.objectAssetLinks(projectId, objectType, objectId),
  });
}

/** Scene assets for a project/manuscript scope (old: fetchSceneAssets(force:true)). */
export function invalidateSceneAssets(projectId: string, manuscriptId?: string): void {
  void queryClient.invalidateQueries({ queryKey: assetKeys.sceneAssets(projectId, manuscriptId) });
}

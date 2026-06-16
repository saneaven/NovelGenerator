/**
 * Asset read queries (project assets, object↔asset links, scene assets).
 *
 * Replaces the old assetStore multi-keyed caches:
 *   - projectAssetsByProject       → useProjectAssetsQuery
 *   - objectAssetsByKey            → useObjectAssetLinksQuery
 *   - sceneAssetsByKey             → useSceneAssetsQuery
 *
 * Each query is `enabled` only when its required ids are present, mirroring the
 * old store's "don't fetch without ids" guards.
 */

import { useQuery } from '@tanstack/react-query';
import { assetService } from '../../api/assetService';
import { assetKeys } from '../keys/assetKeys';
import type { Asset, ObjectAssetLink, SceneAsset } from '../../api/assetService';

const NONE = '__none__';

/** All assets for a project (old: getProjectAssets / projectAssetsByProject). */
export function useProjectAssetsQuery(projectId: string | undefined) {
  return useQuery<Asset[]>({
    queryKey: assetKeys.projectAssets(projectId ?? NONE),
    queryFn: () => assetService.listAssets(projectId as string),
    enabled: Boolean(projectId),
  });
}

/**
 * Object↔asset links for one story object (old: getObjectAssetLinks /
 * objectAssetsByKey, keyed projectId:objectType:objectId).
 */
export function useObjectAssetLinksQuery(
  projectId: string | undefined,
  objectType: string | undefined,
  objectId: string | undefined,
) {
  const enabled = Boolean(projectId && objectType && objectId);
  return useQuery<ObjectAssetLink[]>({
    queryKey: assetKeys.objectAssetLinks(projectId ?? NONE, objectType ?? NONE, objectId ?? NONE),
    queryFn: async () => {
      const response = await assetService.getObjectAssetLinks(
        projectId as string,
        objectType as string,
        objectId as string,
      );
      return response.assets;
    },
    enabled,
  });
}

/**
 * Scene assets for a project, optionally scoped to one manuscript (old:
 * getSceneAssets / sceneAssetsByKey, keyed projectId:manuscriptId|__all__).
 */
export function useSceneAssetsQuery(projectId: string | undefined, manuscriptId?: string) {
  return useQuery<SceneAsset[]>({
    queryKey: assetKeys.sceneAssets(projectId ?? NONE, manuscriptId),
    queryFn: async () => {
      const response = await assetService.listSceneAssets(projectId as string, manuscriptId);
      return response.assets;
    },
    enabled: Boolean(projectId),
  });
}

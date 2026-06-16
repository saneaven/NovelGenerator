/**
 * Main assets for many objects of one type at once (StoryEntityExplorer's grid
 * needs one cover per entity). Replaces the old pattern of reading
 * assetStore.objectAssetsByKey for every entity + an effect fetching each one's
 * links. Each object's links use the same `assetKeys.objectAssetLinks` query as
 * useObjectAssetLinksQuery, so caches are shared with single-object consumers.
 */

import { useQueries } from '@tanstack/react-query';
import { assetService } from '../../api/assetService';
import { assetKeys } from '../keys/assetKeys';
import { selectMainAsset } from './mainAsset';
import type { Asset } from '../../api/assetService';

const NONE = '__none__';

export function useObjectMainAssetsQuery(
  projectId: string | undefined,
  objectType: string,
  objectIds: string[],
): Record<string, Asset | null> {
  return useQueries({
    queries: objectIds.map((objectId) => ({
      queryKey: assetKeys.objectAssetLinks(projectId ?? NONE, objectType, objectId),
      queryFn: async () => {
        const response = await assetService.getObjectAssetLinks(
          projectId as string,
          objectType,
          objectId,
        );
        return response.assets;
      },
      enabled: Boolean(projectId),
    })),
    combine: (results) => {
      const map: Record<string, Asset | null> = {};
      objectIds.forEach((objectId, index) => {
        map[objectId] = selectMainAsset(results[index]?.data);
      });
      return map;
    },
  });
}

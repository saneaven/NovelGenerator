/**
 * Main-asset selection — the one link flagged `is_main` for an object, reduced
 * to its underlying Asset. Replicates the old assetStore.getMainAsset exactly:
 *   `links.find((entry) => entry.is_main)?.asset ?? null`
 */

import { useObjectAssetLinksQuery } from './useAssetQueries';
import type { Asset, ObjectAssetLink } from '../../api/assetService';

/** Pure selector over already-fetched object↔asset links. */
export function selectMainAsset(links: ObjectAssetLink[] | undefined): Asset | null {
  return links?.find((entry) => entry.is_main)?.asset ?? null;
}

/**
 * Hook returning the main asset for an object, fetching its links on demand
 * (replaces the old fetchObjectAssetLinks-in-useEffect + getMainAsset pairing).
 */
export function useMainAsset(
  projectId: string | undefined,
  objectType: string | undefined,
  objectId: string | undefined,
): Asset | null {
  const { data } = useObjectAssetLinksQuery(projectId, objectType, objectId);
  return selectMainAsset(data);
}

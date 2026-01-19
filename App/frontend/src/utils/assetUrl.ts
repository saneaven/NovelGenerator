import { API_BASE_URL } from '../api/client';

export type ImageSize = 'thumbnail' | 'original';

/**
 * Get the URL for an asset, choosing between thumbnail and original.
 *
 * @param asset - Asset object with file_url and optional thumbnail_url
 * @param size - 'thumbnail' (default) prefers thumbnail, 'original' always uses full image
 * @returns Full URL string or null if asset is null/undefined
 */
export function getAssetUrl(
  asset: { file_url?: string; thumbnail_url?: string | null } | null | undefined,
  size: ImageSize = 'thumbnail'
): string | null {
  if (!asset) return null;

  const path = size === 'thumbnail'
    ? (asset.thumbnail_url || asset.file_url)
    : asset.file_url;

  return path ? `${API_BASE_URL}${path}` : null;
}

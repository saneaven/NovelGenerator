import { API_BASE_URL } from '../api/client';

/**
 * Get the URL for an asset (original).
 *
 * @param asset - Asset object with file_url
 * @returns Full URL string or null if asset is null/undefined
 */
export function getAssetUrl(
  asset: { file_url?: string } | null | undefined
): string | null {
  if (!asset) return null;

  return asset.file_url ? `${API_BASE_URL}${asset.file_url}` : null;
}

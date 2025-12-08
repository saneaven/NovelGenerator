/**
 * useCardSpanType - Determines card grid span based on image aspect ratio
 *
 * Returns span type for CSS grid layout:
 * - 'horizontal': wide images (ratio > 1.2) → span 2 columns
 * - 'vertical': tall images (ratio < 0.8) → span 2 rows
 * - 'normal': square-ish images → span 1x1
 * - 'text-only': no image → special typography treatment
 */

import type { Asset } from '../api/assetService';

export type SpanType = 'horizontal' | 'vertical' | 'normal' | 'text-only';

/**
 * Calculate span type from asset dimensions
 */
export function getSpanType(asset: Asset | null): SpanType {
  if (!asset) return 'text-only';
  if (!asset.width || !asset.height) return 'normal';

  const ratio = asset.width / asset.height;

  if (ratio > 1.2) return 'horizontal';  // Wide image → 2 columns
  if (ratio < 0.8) return 'vertical';    // Tall image → 2 rows
  return 'normal';
}

/**
 * Hook to get span types for multiple items
 */
export function useCardSpanTypes(
  items: { id: string }[],
  getAsset: (id: string) => Asset | null
): Record<string, SpanType> {
  const spanTypes: Record<string, SpanType> = {};

  for (const item of items) {
    const asset = getAsset(item.id);
    spanTypes[item.id] = getSpanType(asset);
  }

  return spanTypes;
}

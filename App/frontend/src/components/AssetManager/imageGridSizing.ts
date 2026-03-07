import type { ImageGenerationRecipe } from '../../imageRun';

export function calculateItemHeight(asset: { width?: number | null; height?: number | null }, columnWidth: number): number {
  if (!asset.width || !asset.height) {
    return 180;
  }
  const aspectRatio = asset.width / asset.height;
  const height = Math.round(columnWidth / aspectRatio);
  return Math.max(100, Math.min(height, 400));
}

function parseSize(size?: string): { width: number; height: number } | null {
  if (!size) return null;
  const match = size.trim().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseAspectRatio(aspectRatio?: unknown): number | null {
  if (typeof aspectRatio !== 'string') return null;
  const match = aspectRatio.trim().match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

export function calculatePlaceholderHeight(recipe: ImageGenerationRecipe, columnWidth: number): number {
  const fromSize = parseSize(recipe.size);
  const aspect =
    (fromSize ? fromSize.width / fromSize.height : null)
    ?? parseAspectRatio(recipe.providerSettings?.aspect_ratio)
    ?? 1;

  const height = Math.round(columnWidth / aspect);
  return Math.max(100, Math.min(height, 400));
}

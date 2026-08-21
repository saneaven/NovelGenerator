import type { ImageModelInfo } from '../../api/assetService';

export interface ImageSelectionState {
  model: string;
  aspectRatio: string;
  imageSize: string;
}

export function resolveCatalogSelection(models: ImageModelInfo[], currentModel: string): ImageModelInfo | null {
  if (models.length === 0) return null;
  return models.find((model) => model.id === currentModel) ?? null;
}

export function resolveAspectRatio(model: ImageModelInfo | null, currentValue: string): string {
  if (!model) return currentValue || '1:1';
  return model.supported_aspect_ratios.includes(currentValue) ? currentValue : model.default_aspect_ratio;
}

export function resolveImageSize(model: ImageModelInfo | null, currentValue: string): string {
  if (!model) return currentValue || '1K';
  return model.supported_image_sizes.includes(currentValue) ? currentValue : model.default_image_size;
}

export function resolveSupportedImageSizes(model: ImageModelInfo | null, aspectRatio: string): string[] {
  if (!model) return [];
  if (model.ui_resolution_mode === 'native_exact') {
    return model.supported_image_sizes;
  }
  const paired = model.supported_geometry_pairs?.[aspectRatio];
  if (Array.isArray(paired) && paired.length > 0) {
    return paired;
  }
  return model.supported_image_sizes;
}

export function aspectRatioFromImageSize(size: string): string {
  const text = String(size || '').trim().toLowerCase();
  if (!text.includes('x')) return '1:1';
  const [widthText, heightText] = text.split('x', 2);
  const width = Number.parseInt(widthText, 10);
  const height = Number.parseInt(heightText, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '1:1';
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  return `${Math.floor(width / divisor)}:${Math.floor(height / divisor)}`;
}

export function reconcileSelectionWithModel(
  model: ImageModelInfo | null,
  current: ImageSelectionState,
): ImageSelectionState {
  if (!model) return current;

  if (model.ui_resolution_mode === 'native_exact') {
    const nextImageSize = resolveImageSize(model, current.imageSize);
    return {
      model: model.id,
      aspectRatio: aspectRatioFromImageSize(nextImageSize),
      imageSize: nextImageSize,
    };
  }

  const nextAspectRatio = resolveAspectRatio(model, current.aspectRatio);
  const supportedSizes = resolveSupportedImageSizes(model, nextAspectRatio);
  const nextImageSize = supportedSizes.includes(current.imageSize)
    ? current.imageSize
    : (supportedSizes[0] ?? resolveImageSize(model, current.imageSize));
  return {
    model: model.id,
    aspectRatio: nextAspectRatio,
    imageSize: nextImageSize,
  };
}

export function applyAspectRatioChange(
  model: ImageModelInfo | null,
  current: ImageSelectionState,
  nextAspectRatio: string,
): ImageSelectionState {
  if (!model) {
    return { ...current, aspectRatio: nextAspectRatio };
  }
  const supportedSizes = resolveSupportedImageSizes(model, nextAspectRatio);
  return {
    ...current,
    aspectRatio: nextAspectRatio,
    imageSize: supportedSizes.includes(current.imageSize)
      ? current.imageSize
      : (supportedSizes[0] ?? current.imageSize),
  };
}

export function applyImageSizeChange(
  model: ImageModelInfo | null,
  current: ImageSelectionState,
  nextImageSize: string,
): ImageSelectionState {
  if (model?.ui_resolution_mode === 'native_exact') {
    return {
      ...current,
      imageSize: nextImageSize,
      aspectRatio: aspectRatioFromImageSize(nextImageSize),
    };
  }
  return {
    ...current,
    imageSize: nextImageSize,
  };
}

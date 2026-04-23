import type { Asset } from '../api/assetService';
import type { ImageGenerationRecipe, ReferenceImageRef } from './types';

const OPENAI_GPT_IMAGE_2_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
const OPENAI_GPT_IMAGE_2_IMAGE_SIZES = ['1K', '2K', '4K'] as const;
const OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY = 16;
const OPENAI_GPT_IMAGE_2_TARGET_PIXELS: Record<(typeof OPENAI_GPT_IMAGE_2_IMAGE_SIZES)[number], number> = {
  '1K': 1024 * 1024,
  '2K': 2048 * 2048,
  '4K': 3840 * 2160,
};

function isOpenAiGptImage2(asset: Asset): boolean {
  return asset.generation_provider === 'openai'
    && typeof asset.generation_model === 'string'
    && /^gpt-image-2(?:-|$)/i.test(asset.generation_model);
}

function ratioValue(raw: string): number {
  const [leftText, rightText] = raw.split(':', 2);
  const left = Number.parseInt(leftText, 10);
  const right = Number.parseInt(rightText, 10);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
    return 1;
  }
  return left / right;
}

function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) {
    [left, right] = [right, left % right];
  }
  return left || 1;
}

function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

function parseRatioPair(raw: string): [number, number] {
  const [leftText, rightText] = raw.split(':', 2);
  const left = Number.parseInt(leftText, 10);
  const right = Number.parseInt(rightText, 10);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
    return [1, 1];
  }
  const divisor = gcd(left, right);
  return [Math.floor(left / divisor), Math.floor(right / divisor)];
}

function resolveOpenAiNativeSize(aspectRatio: string, imageSize: (typeof OPENAI_GPT_IMAGE_2_IMAGE_SIZES)[number]): { width: number; height: number } {
  const [widthRatio, heightRatio] = parseRatioPair(aspectRatio);
  const widthStep = OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY / gcd(widthRatio, OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY);
  const heightStep = OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY / gcd(heightRatio, OPENAI_GPT_IMAGE_2_SIZE_GRANULARITY);
  const scaleStep = lcm(widthStep, heightStep);
  const pixelsPerScale = widthRatio * heightRatio;
  const targetPixels = OPENAI_GPT_IMAGE_2_TARGET_PIXELS[imageSize];
  const approxScale = Math.sqrt(targetPixels / pixelsPerScale);
  let lowerScale = Math.floor(approxScale / scaleStep) * scaleStep;
  let upperScale = Math.ceil(approxScale / scaleStep) * scaleStep;
  if (lowerScale === 0) lowerScale = scaleStep;
  if (upperScale === 0) upperScale = scaleStep;
  const bestScale = [lowerScale, upperScale].reduce((best, candidate) => {
    const bestDelta = Math.abs((widthRatio * best * heightRatio * best) - targetPixels);
    const candidateDelta = Math.abs((widthRatio * candidate * heightRatio * candidate) - targetPixels);
    return candidateDelta < bestDelta ? candidate : best;
  });
  return {
    width: widthRatio * bestScale,
    height: heightRatio * bestScale,
  };
}

function inferAspectRatio(asset: Asset): string {
  if (!asset.width || !asset.height) return '1:1';
  if (isOpenAiGptImage2(asset)) {
    const currentRatio = asset.width / asset.height;
    return OPENAI_GPT_IMAGE_2_RATIOS.reduce((best, candidate) => {
      return Math.abs(ratioValue(candidate) - currentRatio) < Math.abs(ratioValue(best) - currentRatio)
        ? candidate
        : best;
    }, '1:1');
  }
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(asset.width, asset.height) || 1;
  return `${Math.floor(asset.width / divisor)}:${Math.floor(asset.height / divisor)}`;
}

function inferImageSize(asset: Asset, aspectRatio: string): string {
  if (!asset.width || !asset.height) return '1K';
  const { width, height } = asset;
  if (isOpenAiGptImage2(asset)) {
    return OPENAI_GPT_IMAGE_2_IMAGE_SIZES.reduce((best, candidate) => {
      const bestNative = resolveOpenAiNativeSize(aspectRatio, best);
      const candidateNative = resolveOpenAiNativeSize(aspectRatio, candidate);
      const bestDelta = Math.abs(bestNative.width - width) + Math.abs(bestNative.height - height);
      const candidateDelta = Math.abs(candidateNative.width - width) + Math.abs(candidateNative.height - height);
      return candidateDelta < bestDelta
        ? candidate
        : best;
    });
  }
  return `${width}x${height}`;
}

function mapReferenceImages(asset: Asset): ReferenceImageRef[] | undefined {
  const refs = asset.generation_reference_images;
  if (!refs || refs.length === 0) return undefined;
  return refs.map((r) => ({ assetId: r.asset_id, strength: r.strength }));
}

function mapMaskImage(asset: Asset): { assetId: string } | undefined {
  const mask = asset.generation_mask_image;
  if (!mask || !mask.asset_id) return undefined;
  return { assetId: mask.asset_id };
}

export function recipeFromAsset(asset: Asset): ImageGenerationRecipe | null {
  const provider = asset.generation_provider;
  const model = asset.generation_model;
  if (!provider || !model) return null;

  const providerSettings = asset.generation_settings ?? undefined;
  const referenceImages = mapReferenceImages(asset);
  const maskImage = mapMaskImage(asset);
  const aspectRatio = inferAspectRatio(asset);
  const imageSize = inferImageSize(asset, aspectRatio);
  const styleId = asset.generation_style_id ?? null;

  if (asset.generation_positive_prompt) {
    return {
      promptType: 'tag_based',
      provider,
      model,
      aspectRatio,
      imageSize,
      positive: asset.generation_positive_prompt,
      negative: asset.generation_negative_prompt ?? undefined,
      providerSettings,
      styleId,
      referenceImages,
      maskImage,
    };
  }

  if (asset.generation_prompt) {
    return {
      promptType: 'natural',
      provider,
      model,
      aspectRatio,
      imageSize,
      prompt: asset.generation_prompt,
      providerSettings,
      styleId,
      referenceImages,
      maskImage,
    };
  }

  return null;
}

import { useMemo } from 'react';
import type { ImageModelInfo } from '../../api/assetService';
import { useProviderSpecs } from '../../data/providers/useProviderSpecsQuery';
import { useImageModelCatalog } from '../useImageModelCatalog';
import { normalizeImageProviderSettingsDraft } from './providerSettings';
import { reconcileSelectionWithModel, resolveSupportedImageSizes } from './selection';

interface UseImageGenerationFormOptions {
  provider: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
  providerSettingsDraft: Record<string, unknown>;
  referenceImageCount?: number;
  hasMaskImage?: boolean;
}

export function useImageGenerationForm(options: UseImageGenerationFormOptions) {
  const providerSpecs = useProviderSpecs();

  const providerSpec = providerSpecs[options.provider];
  const { models, loading, error, selectedModel } = useImageModelCatalog(options.provider, options.model);

  const imageProviders = useMemo(() => {
    const providers = Object.values(providerSpecs).filter((item) => Boolean(item.image));
    providers.sort((a, b) => {
      const left = a.ui.image_order ?? 999;
      const right = b.ui.image_order ?? 999;
      return left - right || a.id.localeCompare(b.id);
    });
    return providers;
  }, [providerSpecs]);

  const currentPromptType = selectedModel?.prompt_type ?? providerSpec?.image?.prompt_type ?? 'natural';
  const isTagBased = currentPromptType === 'tag_based';
  const providerSettingsSpec = providerSpec?.image?.provider_settings ?? null;
  const normalizedProviderSettings = useMemo<Record<string, unknown>>(
    () => normalizeImageProviderSettingsDraft(options.provider, providerSpecs, options.providerSettingsDraft),
    [options.provider, options.providerSettingsDraft, providerSpecs],
  );
  const providerSettingsFlags = useMemo(
    () => ({
      hasReferenceImages: (options.referenceImageCount ?? 0) > 0,
      kontext_model: /kontext/i.test(selectedModel?.id ?? options.model),
    }),
    [options.referenceImageCount, selectedModel, options.model],
  );

  const supportsImageInput = selectedModel?.supports_image_input ?? false;
  const supportsMaskInput = selectedModel?.supports_mask_input ?? false;
  const supportsMultiImageInput = selectedModel?.supports_multi_image_input ?? false;
  const isNativeExact = selectedModel?.ui_resolution_mode === 'native_exact';
  const supportedImageSizes = resolveSupportedImageSizes(selectedModel, options.aspectRatio);
  const generationBlocker = useMemo(() => {
    const referenceImageCount = options.referenceImageCount ?? 0;
    if (referenceImageCount > 0 && !supportsImageInput) {
      return 'The selected model does not support reference images.';
    }
    if (referenceImageCount > 1 && !supportsMultiImageInput) {
      return 'The selected model supports only one input image.';
    }
    if (options.hasMaskImage && !supportsMaskInput) {
      return 'The selected model does not support mask input.';
    }
    if (options.hasMaskImage && referenceImageCount === 0) {
      return 'Add a reference image before using a mask.';
    }
    return null;
  }, [options.hasMaskImage, options.referenceImageCount, supportsImageInput, supportsMaskInput, supportsMultiImageInput]);

  const reconciledSelection = useMemo(
    () => reconcileSelectionWithModel(selectedModel, {
      model: options.model,
      aspectRatio: options.aspectRatio,
      imageSize: options.imageSize,
    }),
    [options.aspectRatio, options.imageSize, options.model, selectedModel],
  );

  return {
    providerSpecs,
    providerSpec,
    imageProviders,
    models,
    loading,
    error,
    selectedModel: selectedModel as ImageModelInfo | null,
    currentPromptType,
    isTagBased,
    providerSettingsSpec,
    normalizedProviderSettings,
    providerSettingsFlags,
    supportsImageInput,
    supportsMaskInput,
    supportsMultiImageInput,
    isNativeExact,
    supportedImageSizes,
    generationBlocker,
    reconciledSelection,
  };
}

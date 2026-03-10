import { useEffect, useMemo, useState } from 'react';
import { assetService, type ImageModelInfo } from '../api/assetService';

const catalogCache = new Map<string, ImageModelInfo[]>();

export function resolveCatalogSelection(models: ImageModelInfo[], currentModel: string): ImageModelInfo | null {
  if (models.length === 0) return null;
  return models.find((model) => model.id === currentModel) ?? models[0];
}

export function resolveAspectRatio(model: ImageModelInfo | null, currentValue: string): string {
  if (!model) return currentValue || '1:1';
  return model.supported_aspect_ratios.includes(currentValue) ? currentValue : model.default_aspect_ratio;
}

export function resolveImageSize(model: ImageModelInfo | null, currentValue: string): string {
  if (!model) return currentValue || '1K';
  return model.supported_image_sizes.includes(currentValue) ? currentValue : model.default_image_size;
}

export function useImageModelCatalog(provider: string, currentModel: string) {
  const shouldUseCache = provider !== 'openrouter';
  const [models, setModels] = useState<ImageModelInfo[]>(() => shouldUseCache ? (catalogCache.get(provider) ?? []) : []);
  const [loading, setLoading] = useState(shouldUseCache ? !catalogCache.has(provider) : true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cached = shouldUseCache ? catalogCache.get(provider) : undefined;
    if (cached) {
      setModels(cached);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    void assetService.getImageModels(provider)
      .then((nextModels) => {
        if (cancelled) return;
        if (shouldUseCache) {
          catalogCache.set(provider, nextModels);
        }
        setModels(nextModels);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load image models');
        setModels([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provider, shouldUseCache]);

  const selectedModel = useMemo(() => resolveCatalogSelection(models, currentModel), [models, currentModel]);

  return { models, loading, error, selectedModel };
}

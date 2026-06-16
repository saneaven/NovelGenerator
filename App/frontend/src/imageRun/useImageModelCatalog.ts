import { useEffect, useMemo, useState } from 'react';
import { assetService, type ImageModelInfo } from '../api/assetService';
import { useProviderSpec } from '../data/providers/useProviderSpecsQuery';
import { projectImageModels, toImageModelInfo } from '../providerEngine/utils';
import {
  resolveAspectRatio,
  resolveCatalogSelection,
  resolveImageSize,
  resolveSupportedImageSizes,
  aspectRatioFromImageSize,
} from './form/selection';

const catalogCache = new Map<string, ImageModelInfo[]>();

function shouldCacheCatalog(cachePolicy: 'static' | 'session' | 'none' | undefined): boolean {
  return cachePolicy === 'static' || cachePolicy === 'session';
}

export {
  resolveCatalogSelection,
  resolveAspectRatio,
  resolveImageSize,
  resolveSupportedImageSizes,
  aspectRatioFromImageSize,
};

export function useImageModelCatalog(provider: string, currentModel: string) {
  const providerSpec = useProviderSpec(provider);
  const staticModels = useMemo(
    () => (
      providerSpec?.image && !providerSpec.image.has_dynamic_models
        ? projectImageModels(providerSpec).map(toImageModelInfo)
        : null
    ),
    [providerSpec],
  );
  const cachePolicy = providerSpec?.image?.catalog_cache_policy;
  const shouldUseCache = shouldCacheCatalog(cachePolicy);
  const shouldFetchDynamicModels = Boolean(providerSpec?.image?.has_dynamic_models);

  const [models, setModels] = useState<ImageModelInfo[]>(() => {
    if (staticModels) return staticModels;
    return shouldUseCache ? (catalogCache.get(provider) ?? []) : [];
  });
  const [loading, setLoading] = useState(() => {
    if (!providerSpec) return true;
    if (staticModels) return false;
    return shouldUseCache ? !catalogCache.has(provider) : shouldFetchDynamicModels;
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!providerSpec) {
      setModels([]);
      setLoading(true);
      setError(null);
      return;
    }

    if (staticModels) {
      setModels(staticModels);
      setLoading(false);
      setError(null);
      return;
    }

    if (!shouldFetchDynamicModels) {
      setModels([]);
      setLoading(false);
      setError(null);
      return;
    }

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
  }, [provider, providerSpec, shouldFetchDynamicModels, shouldUseCache, staticModels]);

  const selectedModel = useMemo(() => resolveCatalogSelection(models, currentModel), [models, currentModel]);

  return { models, loading, error, selectedModel };
}

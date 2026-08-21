import type { ImageGenerationRecipe } from '../types';
import type { PublicProviderSpec } from '../../providerEngine/types';
import {
  buildDefaultObjectValue,
  getStoredProviderSettings,
  normalizeByPublicSpec,
} from '../../providerEngine/utils';

type ProviderSpecMap = Record<string, PublicProviderSpec>;

function readRetrySettings(
  providerId: string,
  recipe?: ImageGenerationRecipe | null,
): Record<string, unknown> {
  if (!recipe || recipe.provider !== providerId) return {};
  return recipe.providerSettings && typeof recipe.providerSettings === 'object' && !Array.isArray(recipe.providerSettings)
    ? recipe.providerSettings
    : {};
}

export function buildImageProviderSettingsDraft(
  providerId: string,
  providerSpecs: ProviderSpecMap,
  storedConfig: Record<string, unknown>,
  recipe?: ImageGenerationRecipe | null,
): Record<string, unknown> {
  const spec = providerSpecs[providerId]?.image?.provider_settings;
  if (!spec) return {};

  const defaults = buildDefaultObjectValue(spec);
  const stored = getStoredProviderSettings(storedConfig, providerId);
  const retry = readRetrySettings(providerId, recipe);
  const merged = {
    ...defaults,
    ...stored,
    ...retry,
  };
  return normalizeByPublicSpec(merged, spec, merged, {
    hasReferenceImages: (recipe?.referenceImages?.length ?? 0) > 0,
  });
}

export function normalizeImageProviderSettingsDraft(
  providerId: string,
  providerSpecs: ProviderSpecMap,
  draft: Record<string, unknown>,
  flags: Record<string, unknown> = {},
): Record<string, unknown> {
  const spec = providerSpecs[providerId]?.image?.provider_settings;
  if (!spec) return {};
  return normalizeByPublicSpec(draft, spec, draft, flags);
}

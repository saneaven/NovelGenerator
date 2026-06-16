/**
 * Pure selectors over the provider-spec collection.
 *
 * These operate on a passed-in specs record (the shape produced by
 * `useProviderSpecsQuery`), or — for non-React callers — read the latest
 * cached value via `getQueryData`. They contain no React or store state.
 */

import { queryClient } from '../queryClient';
import { providerKeys } from '../keys/providerKeys';
import type { PublicProviderSpec } from '../../providerEngine/types';

export type ProviderCapability = 'llm' | 'embedding' | 'image';

/** Id → spec record, the canonical shape consumers subscribe to. */
export type ProviderSpecMap = Record<string, PublicProviderSpec>;

/** Read the current provider-spec map from the query cache (empty if unfetched). */
export function readProviderSpecsFromCache(): ProviderSpecMap {
  return queryClient.getQueryData<ProviderSpecMap>(providerKeys.specs()) ?? {};
}

/** A single provider spec by id from a given map. */
export function selectProviderSpec(
  specs: ProviderSpecMap,
  providerId: string,
): PublicProviderSpec | undefined {
  return specs[String(providerId || '').trim()];
}

/** Providers exposing a given capability, sorted by that capability's UI order then id. */
export function selectProviderSpecsByCapability(
  specs: ProviderSpecMap,
  capability: ProviderCapability,
): PublicProviderSpec[] {
  const providers = Object.values(specs).filter((provider) => Boolean(provider[capability]));
  const orderKey =
    capability === 'llm'
      ? 'llm_order'
      : capability === 'embedding'
        ? 'embedding_order'
        : 'image_order';
  providers.sort((a, b) => {
    const left = a.ui[orderKey] ?? 999;
    const right = b.ui[orderKey] ?? 999;
    return left - right || a.id.localeCompare(b.id);
  });
  return providers;
}

/**
 * Non-React accessor: a single provider spec by id from the query cache.
 * Mirrors the old module-level `getProviderSpec`.
 */
export function getProviderSpec(providerId: string): PublicProviderSpec | undefined {
  return selectProviderSpec(readProviderSpecsFromCache(), providerId);
}

/**
 * Non-React accessor: providers by capability from the query cache.
 * Mirrors the old module-level `listProviderSpecsByCapability`.
 */
export function listProviderSpecsByCapability(
  capability: ProviderCapability,
): PublicProviderSpec[] {
  return selectProviderSpecsByCapability(readProviderSpecsFromCache(), capability);
}

/**
 * Query for the provider-spec catalog.
 *
 * Provider specs are static for the lifetime of a session (they describe the
 * backend's configured providers, not user data), so `staleTime: Infinity`
 * means a single fetch serves every consumer. TanStack dedupes concurrent
 * subscribers natively, replacing the old `inflightLoad` global.
 *
 * The query data is keyed by provider id (`Record<string, PublicProviderSpec>`)
 * so consumers can both `Object.values(...)` and index `specs[id]` directly.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchProviderSpecs } from '../../api/providerService';
import { providerKeys } from '../keys/providerKeys';
import type { PublicProviderSpec } from '../../providerEngine/types';
import {
  selectProviderSpec,
  selectProviderSpecsByCapability,
  type ProviderCapability,
  type ProviderSpecMap,
} from './providerSelectors';

const EMPTY_SPECS: ProviderSpecMap = {};

async function fetchProviderSpecMap(): Promise<ProviderSpecMap> {
  const response = await fetchProviderSpecs();
  const providers = Array.isArray(response.providers) ? response.providers : [];
  return Object.fromEntries(providers.map((provider) => [provider.id, provider]));
}

/**
 * Shared query options, so non-React callers (e.g. `queryClient.fetchQuery`)
 * fetch the catalog with the exact same key, fetcher, and freshness as the hook.
 */
export const providerSpecsQueryOptions = {
  queryKey: providerKeys.specs(),
  queryFn: fetchProviderSpecMap,
  staleTime: Infinity,
} as const;

/** Subscribe to the provider-spec catalog (id → spec). */
export function useProviderSpecsQuery() {
  return useQuery(providerSpecsQueryOptions);
}

/** Reactive id → spec map (empty object until loaded). */
export function useProviderSpecs(): ProviderSpecMap {
  return useProviderSpecsQuery().data ?? EMPTY_SPECS;
}

/** A single provider spec by id, reactively. */
export function useProviderSpec(providerId: string): PublicProviderSpec | undefined {
  const specs = useProviderSpecs();
  return useMemo(() => selectProviderSpec(specs, providerId), [specs, providerId]);
}

/** Providers exposing a capability, sorted, reactively. */
export function useProviderSpecsByCapability(capability: ProviderCapability): PublicProviderSpec[] {
  const specs = useProviderSpecs();
  return useMemo(() => selectProviderSpecsByCapability(specs, capability), [specs, capability]);
}

import { create } from 'zustand';
import apiClient from '../api/client';
import type { PublicProviderSpec, PublicProviderSpecResponse } from './types';

type Capability = 'llm' | 'embedding' | 'image';

interface ProviderSpecState {
  specs: Record<string, PublicProviderSpec>;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  get: (providerId: string) => PublicProviderSpec | undefined;
  listByCapability: (capability: Capability) => PublicProviderSpec[];
}

let inflightLoad: Promise<void> | null = null;

export const useProviderSpecStore = create<ProviderSpecState>((set, get) => ({
  specs: {},
  loading: false,
  loaded: false,
  error: null,
  async load() {
    if (get().loaded) return;
    if (inflightLoad) return inflightLoad;

    inflightLoad = (async () => {
      set({ loading: true, error: null });
      try {
        const response = await apiClient.get<PublicProviderSpecResponse>('/api/v1/provider-specs');
        const providers = Array.isArray(response.providers) ? response.providers : [];
        set({
          specs: Object.fromEntries(providers.map((provider) => [provider.id, provider])),
          loaded: true,
          loading: false,
          error: null,
        });
      } catch (error) {
        set({
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to load provider specs',
        });
        throw error;
      } finally {
        inflightLoad = null;
      }
    })();

    return inflightLoad;
  },
  get(providerId) {
    return get().specs[String(providerId || '').trim()];
  },
  listByCapability(capability) {
    const providers = Object.values(get().specs).filter((provider) => Boolean(provider[capability]));
    providers.sort((a, b) => {
      const orderKey =
        capability === 'llm'
          ? 'llm_order'
          : capability === 'embedding'
            ? 'embedding_order'
            : 'image_order';
      const left = a.ui[orderKey] ?? 999;
      const right = b.ui[orderKey] ?? 999;
      return left - right || a.id.localeCompare(b.id);
    });
    return providers;
  },
}));

export function getProviderSpec(providerId: string): PublicProviderSpec | undefined {
  return useProviderSpecStore.getState().get(providerId);
}

export function listProviderSpecsByCapability(capability: Capability): PublicProviderSpec[] {
  return useProviderSpecStore.getState().listByCapability(capability);
}

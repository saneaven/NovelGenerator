import { create } from 'zustand';
import { assetService, type ImageProvider } from '../../api/assetService';
import { useCredentialsStore } from '../../store/credentialsStore';

type ModelInfo = { id: string; name: string };

function getApiKeyForImageProvider(provider: string): string {
  const creds = useCredentialsStore.getState().credentials;
  switch (provider) {
    case 'openai':
      return creds.openai.apiKey;
    case 'gemini':
      return creds.gemini.apiKey;
    case 'xai':
      return creds.xai.apiKey;
    case 'novelai':
      return creds.novelai.apiKey;
    default:
      return '';
  }
}

interface ProviderCatalogState {
  providers: ImageProvider[];
  modelsByProvider: Record<string, ModelInfo[] | undefined>;
  isLoading: boolean;
  error?: string;

  fetchProviders: () => Promise<void>;
  fetchModels: (provider: string) => Promise<void>;

  getProvider: (name: string) => ImageProvider | null;
  supportsImageInput: (name: string) => boolean;
}

export const useImageProviderCatalogStore = create<ProviderCatalogState>((set, get) => ({
  providers: [],
  modelsByProvider: {},
  isLoading: false,
  error: undefined,

  fetchProviders: async () => {
    set({ isLoading: true, error: undefined });
    try {
      const providers = await assetService.listImageProviders();
      set({ providers, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Failed to fetch providers' });
    }
  },

  fetchModels: async (provider) => {
    const key = provider;
    if (get().modelsByProvider[key]) return;
    set({ isLoading: true, error: undefined });
    try {
      const apiKey = getApiKeyForImageProvider(provider);
      if (!apiKey) {
        set({ isLoading: false, error: `API key not configured for ${provider}` });
        return;
      }
      const models = await assetService.getImageModels(provider, apiKey);
      set((state) => ({
        modelsByProvider: { ...state.modelsByProvider, [key]: models },
        isLoading: false,
      }));
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Failed to fetch models' });
    }
  },

  getProvider: (name) => get().providers.find((p) => p.name === name) ?? null,
  supportsImageInput: (name) => get().providers.find((p) => p.name === name)?.supports_image_input ?? false,
}));

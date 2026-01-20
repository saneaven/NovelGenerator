import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderConfig, ProviderCredentials, ProviderType } from './settingsStore';
import { credentialsService, type CredentialVaultStatusResponse } from '../api/credentialsService';

export interface CredentialsStore {
  credentials: ProviderCredentials;
  serverVaultEnabled: boolean;
  serverStatus: CredentialVaultStatusResponse | null;
  isSyncing: boolean;

  setCredentials: (credentials: ProviderCredentials) => void;
  setServerVaultEnabled: (enabled: boolean) => void;

  getProviderConfig: (provider: ProviderType) => ProviderConfig;
  getProviderConfigForBackend: (provider: ProviderType) => ProviderConfig;

  fetchServerStatus: () => Promise<void>;
  pushToServerIfEnabled: () => Promise<void>;
  deleteServerCredentials: () => Promise<void>;
}

const defaultCredentials: ProviderCredentials = {
  openai: { apiKey: '' },
  gemini: { apiKey: '' },
  claude: { apiKey: '' },
  openrouter: { apiKey: '' },
  custom: { baseUrl: '', apiKey: '' },
  xai: { apiKey: '' },
  novelai: { apiKey: '' },
};

export const useCredentialsStore = create<CredentialsStore>()(
  persist(
    (set, get) => ({
      credentials: defaultCredentials,
      serverVaultEnabled: false,
      serverStatus: null,
      isSyncing: false,

      setCredentials: (credentials) => set({ credentials }),
      setServerVaultEnabled: (enabled) => set({ serverVaultEnabled: enabled }),

      getProviderConfig: (provider) => {
        const creds = get().credentials;
        if (provider === 'custom') {
          return {
            apiKey: creds.custom.apiKey || undefined,
            baseUrl: creds.custom.baseUrl || undefined,
          };
        }
        return { apiKey: (creds as any)[provider]?.apiKey || undefined };
      },

      getProviderConfigForBackend: (provider) => {
        const cfg = get().getProviderConfig(provider);
        if (!get().serverVaultEnabled) return cfg;
        // Vault mode: omit apiKey to let backend resolve from encrypted storage.
        return { ...cfg, apiKey: undefined };
      },

      fetchServerStatus: async () => {
        set({ isSyncing: true });
        try {
          const status = await credentialsService.getStatus();
          set({ serverStatus: status });
        } finally {
          set({ isSyncing: false });
        }
      },

      pushToServerIfEnabled: async () => {
        if (!get().serverVaultEnabled) return;
        set({ isSyncing: true });
        try {
          const status = await credentialsService.upsert(get().credentials);
          set({ serverStatus: status });
        } finally {
          set({ isSyncing: false });
        }
      },

      deleteServerCredentials: async () => {
        set({ isSyncing: true });
        try {
          const status = await credentialsService.delete();
          set({ serverStatus: status });
        } finally {
          set({ isSyncing: false });
        }
      },
    }),
    {
      name: 'credentials-storage',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          try {
            return JSON.parse(str);
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          localStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: (name) => {
          localStorage.removeItem(name);
        },
      },
      merge: (persistedState: any, currentState: CredentialsStore) => {
        return {
          ...currentState,
          credentials: {
            ...defaultCredentials,
            ...(persistedState?.credentials || {}),
          },
          serverVaultEnabled: persistedState?.serverVaultEnabled ?? false,
          serverStatus: persistedState?.serverStatus ?? null,
        };
      },
    }
  )
);


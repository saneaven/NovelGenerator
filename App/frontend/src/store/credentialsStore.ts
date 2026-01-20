import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderConfig, ProviderCredentials, ProviderType } from './settingsStore';
import {
  credentialsBackupService,
  type CredentialBackupStatusResponse,
} from '../api/credentialsBackupService';
import { decryptCredentialsFromBackup, encryptCredentialsForBackup } from '../security/credentialsBackupCrypto';

export interface CredentialsStore {
  credentials: ProviderCredentials;
  backupStatus: CredentialBackupStatusResponse | null;
  isSyncing: boolean;

  setCredentials: (credentials: ProviderCredentials) => void;

  getProviderConfig: (provider: ProviderType) => ProviderConfig;
  getProviderConfigForBackend: (provider: ProviderType) => ProviderConfig;

  fetchBackupStatus: () => Promise<void>;
  backupToServer: (password: string, credentials?: ProviderCredentials) => Promise<void>;
  restoreFromServer: (password: string) => Promise<ProviderCredentials>;
  deleteServerBackup: (password: string) => Promise<void>;
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
      backupStatus: null,
      isSyncing: false,

      setCredentials: (credentials) => set({ credentials }),

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
        return get().getProviderConfig(provider);
      },

      fetchBackupStatus: async () => {
        set({ isSyncing: true });
        try {
          const status = await credentialsBackupService.getStatus();
          set({ backupStatus: status });
        } finally {
          set({ isSyncing: false });
        }
      },

      backupToServer: async (password: string, credentials?: ProviderCredentials) => {
        set({ isSyncing: true });
        try {
          const creds = credentials ?? get().credentials;
          const blob = await encryptCredentialsForBackup(creds, password);
          const status = await credentialsBackupService.upload(password, blob);
          set({ backupStatus: status });
        } finally {
          set({ isSyncing: false });
        }
      },

      restoreFromServer: async (password: string) => {
        set({ isSyncing: true });
        try {
          const res = await credentialsBackupService.download(password);
          const creds = await decryptCredentialsFromBackup(res.blob, password);
          set({ credentials: creds, backupStatus: { hasBackup: true, updatedAt: res.updatedAt } });
          return creds;
        } finally {
          set({ isSyncing: false });
        }
      },

      deleteServerBackup: async (password: string) => {
        set({ isSyncing: true });
        try {
          const status = await credentialsBackupService.delete(password);
          set({ backupStatus: status });
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
          backupStatus: persistedState?.backupStatus ?? null,
        };
      },
    }
  )
);

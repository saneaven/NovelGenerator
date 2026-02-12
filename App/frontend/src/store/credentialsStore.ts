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
  custom: { baseUrl: '', apiKey: '', additionalHeadersJson: '{}', additionalBodyJson: '{}' },
  xai: { apiKey: '' },
  novelai: { apiKey: '' },
};

function parseJsonObject(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function toStringRecord(value: Record<string, unknown> | undefined): Record<string, string> | undefined {
  if (!value) return undefined;
  const output: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string') {
      output[k] = v;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function normalizeCredentials(credentials: Partial<ProviderCredentials>): ProviderCredentials {
  return {
    ...defaultCredentials,
    ...credentials,
    custom: {
      ...defaultCredentials.custom,
      ...(credentials.custom || {}),
    },
  };
}

export const useCredentialsStore = create<CredentialsStore>()(
  persist(
    (set, get) => ({
      credentials: defaultCredentials,
      backupStatus: null,
      isSyncing: false,

      setCredentials: (credentials) => set({ credentials: normalizeCredentials(credentials) }),

      getProviderConfig: (provider) => {
        const creds = get().credentials;
        if (provider === 'custom') {
          const parsedHeaders = parseJsonObject(creds.custom.additionalHeadersJson);
          const parsedBody = parseJsonObject(creds.custom.additionalBodyJson);
          return {
            apiKey: creds.custom.apiKey || undefined,
            baseUrl: creds.custom.baseUrl || undefined,
            additionalHeaders: toStringRecord(parsedHeaders),
            additionalBody: parsedBody && Object.keys(parsedBody).length > 0 ? parsedBody : undefined,
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
          const creds = normalizeCredentials(credentials ?? get().credentials);
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
          const creds = normalizeCredentials(await decryptCredentialsFromBackup(res.blob, password));
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
          credentials: normalizeCredentials((persistedState?.credentials || {}) as Partial<ProviderCredentials>),
          backupStatus: persistedState?.backupStatus ?? null,
        };
      },
    }
  )
);

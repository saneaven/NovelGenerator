import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ProviderType = 'copilot' | 'openrouter' | 'custom';

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  additionalHeaders?: Record<string, string>;
}

export interface ProviderPreference {
  only?: string[];
  ignore?: string[];
}

export interface Settings {
  // Active provider
  activeProvider: ProviderType;

  // Model selection
  aiModel: string;

  // Provider configurations
  providers: {
    copilot: {};
    openrouter: {
      apiKey: string;
    };
    custom: {
      baseUrl: string;
      apiKey?: string;
    };
  };

  // Provider preferences for OpenRouter models
  providerPreferences: {
    [modelId: string]: ProviderPreference;
  };

  // Language settings
  primaryLanguage: string;
  secondaryLanguage: string | null;
}

interface SettingsStore {
  settings: Settings;

  // Actions
  setActiveProvider: (provider: ProviderType) => void;
  setAiModel: (model: string) => void;
  setProviderConfig: (provider: ProviderType, config: any) => void;
  setPrimaryLanguage: (language: string) => void;
  setSecondaryLanguage: (language: string | null) => void;
  updateSettings: (updates: Partial<Settings>) => void;
  resetToDefaults: () => void;
  getActiveProviderConfig: () => ProviderConfig;
  setProviderPreference: (modelId: string, preference: ProviderPreference) => void;
  clearProviderPreference: (modelId: string) => void;
  getProviderPreference: (modelId: string) => ProviderPreference | undefined;
}

const defaultSettings: Settings = {
  activeProvider: 'copilot',
  aiModel: 'gpt-5-mini',
  providers: {
    copilot: {},
    openrouter: {
      apiKey: ''
    },
    custom: {
      baseUrl: '',
      apiKey: ''
    }
  },
  providerPreferences: {},
  primaryLanguage: 'English',
  secondaryLanguage: null
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,

      setActiveProvider: (provider: ProviderType) => {
        set((state) => ({
          settings: {
            ...state.settings,
            activeProvider: provider
          }
        }));
      },

      setAiModel: (model: string) => {
        set((state) => ({
          settings: {
            ...state.settings,
            aiModel: model
          }
        }));
      },

      setProviderConfig: (provider: ProviderType, config: any) => {
        set((state) => ({
          settings: {
            ...state.settings,
            providers: {
              ...state.settings.providers,
              [provider]: config
            }
          }
        }));
      },

      setPrimaryLanguage: (language: string) => {
        set((state) => ({
          settings: {
            ...state.settings,
            primaryLanguage: language
          }
        }));
      },

      setSecondaryLanguage: (language: string | null) => {
        set((state) => ({
          settings: {
            ...state.settings,
            secondaryLanguage: language
          }
        }));
      },

      updateSettings: (updates: Partial<Settings>) => {
        set((state) => ({
          settings: {
            ...state.settings,
            ...updates
          }
        }));
      },

      resetToDefaults: () => {
        set({ settings: { ...defaultSettings } });
      },

      getActiveProviderConfig: () => {
        const state = get();
        const provider = state.settings.activeProvider;
        return state.settings.providers[provider] as ProviderConfig;
      },

      setProviderPreference: (modelId: string, preference: ProviderPreference) => {
        set((state) => ({
          settings: {
            ...state.settings,
            providerPreferences: {
              ...(state.settings.providerPreferences || {}),
              [modelId]: preference
            }
          }
        }));
      },

      clearProviderPreference: (modelId: string) => {
        set((state) => {
          const prefs = state.settings.providerPreferences || {};
          const { [modelId]: removed, ...rest } = prefs;
          return {
            settings: {
              ...state.settings,
              providerPreferences: rest
            }
          };
        });
      },

      getProviderPreference: (modelId: string) => {
        const state = get();
        return state.settings.providerPreferences?.[modelId];
      }
    }),
    {
      name: 'settings-storage',
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          try {
            const parsed = JSON.parse(str);
            // Migration: Ensure providerPreferences exists
            if (parsed?.state?.settings && !parsed.state.settings.providerPreferences) {
              parsed.state.settings.providerPreferences = {};
            }
            return parsed;
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
    }
  )
);

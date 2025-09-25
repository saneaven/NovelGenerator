import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Settings {
  aiModel: string;
  primaryLanguage: string;
  secondaryLanguage: string | null;
}

interface SettingsStore {
  settings: Settings;

  // Actions
  setAiModel: (model: string) => void;
  setPrimaryLanguage: (language: string) => void;
  setSecondaryLanguage: (language: string | null) => void;
  updateSettings: (updates: Partial<Settings>) => void;
  resetToDefaults: () => void;
}

const defaultSettings: Settings = {
  aiModel: 'gpt-5-mini',
  primaryLanguage: 'English',
  secondaryLanguage: null
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, _get) => ({
      settings: defaultSettings,

      setAiModel: (model: string) => {
        set((state) => ({
          settings: {
            ...state.settings,
            aiModel: model
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
    }),
    {
      name: 'settings-storage',
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
    }
  )
);

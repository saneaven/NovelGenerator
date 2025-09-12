import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Settings {
  aiModel: string;
  outputLanguage: string;
}

interface SettingsStore {
  settings: Settings;
  
  // Actions
  setAiModel: (model: string) => void;
  setOutputLanguage: (language: string) => void;
  updateSettings: (updates: Partial<Settings>) => void;
  resetToDefaults: () => void;
}

const defaultSettings: Settings = {
  aiModel: 'gpt-5-mini',
  outputLanguage: 'English'
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,

      setAiModel: (model: string) => {
        set((state) => ({
          settings: {
            ...state.settings,
            aiModel: model
          }
        }));
      },

      setOutputLanguage: (language: string) => {
        set((state) => ({
          settings: {
            ...state.settings,
            outputLanguage: language
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
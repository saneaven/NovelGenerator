import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsService } from '../api/settingsService';
import { promptService } from '../api/promptService';
import type { FunctionType, PromptCategory } from '../types/prompts';
import { getPromptKey } from '../types/prompts';

// Types
export type ProviderType = 'openai' | 'gemini' | 'claude' | 'openrouter' | 'custom';
export type AIFunctionType = 'chat' | 'translation' | 'storyEdit' | 'chapterGen';
export type ThemeMode = 'light' | 'dark' | 'system';

// Generic provider config (for API requests)
export interface ProviderConfig {
    apiKey?: string;
    baseUrl?: string;
    additionalHeaders?: Record<string, string>;
}

// Provider configurations (credentials only - shared across functions)
export interface ProviderCredentials {
    openai: {
        apiKey: string;
    };
    gemini: {
        apiKey: string;
    };
    claude: {
        apiKey: string;
    };
    openrouter: {
        apiKey: string;
    };
    custom: {
        baseUrl: string;
        apiKey?: string;
    };
}

// OpenRouter provider preference
export interface ProviderPreference {
    only?: string[];
    ignore?: string[];
}

// Thinking configuration for model-native thinking
export interface ThinkingConfig {
    effort?: 'none' | 'low' | 'medium' | 'high';  // 'none' for GPT-5
    maxTokens?: number;
    verbosity?: 'low' | 'medium' | 'high';  // GPT-5 output verbosity
    claudeBudgetTokens?: number;
    geminiThinkingLevel?: 'low' | 'high';  // Gemini only supports low/high
    geminiBudgetTokens?: number;
}

// Advanced settings for AI functions
export interface AdvancedFunctionSettings {
    enablePrefill: boolean;
    thinkingMode: 'off' | 'model' | 'custom';
    thinkingConfig?: ThinkingConfig;
}

// Complete configuration for a single AI function
export interface FunctionAIConfig {
    provider: ProviderType;
    model: string;
    temperature: number;
    providerPreference?: ProviderPreference;
    advanced: AdvancedFunctionSettings;
}

// Main settings interface
export interface Settings {
    // Shared provider credentials
    providerCredentials: ProviderCredentials;

    // Per-function complete configurations
    functionConfigs: {
        [K in AIFunctionType]: FunctionAIConfig;
    };

    // Language settings
    mainLanguage: string;
    subLanguages: string[];
    defaultSubLanguage: string | null;

    // Theme settings
    theme: ThemeMode;
}

// Default settings
const defaultSettings: Settings = {
    providerCredentials: {
        openai: {
            apiKey: '',
        },
        gemini: {
            apiKey: '',
        },
        claude: {
            apiKey: '',
        },
        openrouter: {
            apiKey: '',
        },
        custom: {
            baseUrl: '',
            apiKey: '',
        },
    },

    functionConfigs: {
        // Chat: Fast and cheap for conversation
        chat: {
            provider: 'openrouter',
            model: 'gpt-4o-mini',
            temperature: 0.7,
            advanced: {
                enablePrefill: false,
                thinkingMode: 'off',
                thinkingConfig: {
                    effort: 'medium',
                },
            },
        },

        // Translation: Accurate for language translation
        translation: {
            provider: 'openrouter',
            model: 'gpt-4o',
            temperature: 0.2,
            advanced: {
                enablePrefill: false,
                thinkingMode: 'off',
                thinkingConfig: {
                    effort: 'medium',
                },
            },
        },

        // Story Edit: Good at structured editing
        storyEdit: {
            provider: 'openrouter',
            model: 'gpt-4o',
            temperature: 0.3,
            advanced: {
                enablePrefill: false,
                thinkingMode: 'off',
                thinkingConfig: {
                    effort: 'medium',
                },
            },
        },

        // Chapter Gen: Creative writing
        chapterGen: {
            provider: 'openrouter',
            model: 'gpt-4o',
            temperature: 0.7,
            advanced: {
                enablePrefill: true,
                thinkingMode: 'off',
                thinkingConfig: {
                    effort: 'medium',
                },
            },
        },
    },

    mainLanguage: 'English',
    subLanguages: [],
    defaultSubLanguage: null,

    // Default to system theme preference
    theme: 'system',
};

// Store interface
interface SettingsStore {
    settings: Settings;
    isLoading: boolean;
    lastSyncedAt: string | null;

    // Prompt cache
    promptCache: Map<string, string>;

    // Sync methods
    loadFromServer: () => Promise<void>;
    saveToServer: () => Promise<void>;

    // Provider credentials setters
    setProviderCredential: (provider: ProviderType, credentials: any) => void;

    // Function config setters
    setFunctionConfig: (functionType: AIFunctionType, config: FunctionAIConfig) => void;
    setFunctionProvider: (functionType: AIFunctionType, provider: ProviderType) => void;
    setFunctionModel: (functionType: AIFunctionType, model: string) => void;
    setFunctionTemperature: (functionType: AIFunctionType, temperature: number) => void;
    setFunctionProviderPreference: (functionType: AIFunctionType, pref?: ProviderPreference) => void;
    setFunctionAdvanced: (functionType: AIFunctionType, advanced: Partial<AdvancedFunctionSettings>) => void;

    // Getters
    getFunctionConfig: (functionType: AIFunctionType) => FunctionAIConfig;
    getProviderConfig: (provider: ProviderType) => any;

    // Language setters
    setMainLanguage: (language: string) => void;
    setSubLanguages: (languages: string[]) => void;
    setDefaultSubLanguage: (language: string | null) => void;
    addSubLanguage: (language: string) => void;
    removeSubLanguage: (language: string) => void;

    // Theme setter
    setTheme: (theme: ThemeMode) => void;

    // Prompt methods
    loadPrompt: (functionType: FunctionType, category: PromptCategory, name?: string) => Promise<string>;
    getPromptFromCache: (functionType: FunctionType, category: PromptCategory, name?: string) => string | null;
    invalidatePromptCache: (functionType?: FunctionType, category?: PromptCategory, name?: string) => void;

    // Other methods
    updateSettings: (updates: Partial<Settings>) => void;
    resetToDefaults: () => void;
}

// Helper to normalize advanced settings without legacy fallbacks
const migrateAdvancedSettings = (advanced: any): AdvancedFunctionSettings => ({
    enablePrefill: advanced.enablePrefill ?? false,
    thinkingMode: advanced.thinkingMode ?? 'off',
    thinkingConfig: advanced.thinkingConfig ?? { effort: 'medium' },
});

// Helper to merge stored settings with defaults
const mergeWithDefaults = (stored: any): Settings => {
    if (!stored || typeof stored !== 'object') {
        return defaultSettings;
    }

    const migratedFunctionConfigs: any = {};
    if (stored.functionConfigs) {
        for (const [key, config] of Object.entries(stored.functionConfigs) as [string, any][]) {
            migratedFunctionConfigs[key] = {
                ...defaultSettings.functionConfigs[key as AIFunctionType],
                ...config,
                advanced: migrateAdvancedSettings(config.advanced || {}),
            };
        }
    }

    return {
        providerCredentials: {
            ...defaultSettings.providerCredentials,
            ...stored.providerCredentials,
        },
        functionConfigs: {
            ...defaultSettings.functionConfigs,
            ...migratedFunctionConfigs,
        },
        mainLanguage: stored.mainLanguage ?? defaultSettings.mainLanguage,
        subLanguages: stored.subLanguages ?? defaultSettings.subLanguages,
        defaultSubLanguage: stored.defaultSubLanguage ?? defaultSettings.defaultSubLanguage,
        theme: stored.theme ?? defaultSettings.theme,
    };
};

export const useSettingsStore = create<SettingsStore>()(
    persist(
        (set, get) => ({
            settings: defaultSettings,
            isLoading: false,
            lastSyncedAt: null,
            promptCache: new Map<string, string>(),

            // Sync methods
            loadFromServer: async () => {
                set({ isLoading: true });
                try {
                    const serverSettings = await settingsService.getSettings();
                    // Merge server settings with defaults to ensure new configs are included
                    set({
                        settings: mergeWithDefaults(serverSettings),
                        lastSyncedAt: new Date().toISOString(),
                        isLoading: false,
                    });
                } catch (error) {
                    console.error('Failed to load settings from server:', error);
                    set({ isLoading: false });
                }
            },

            saveToServer: async () => {
                try {
                    await settingsService.updateSettings(get().settings);
                    set({ lastSyncedAt: new Date().toISOString() });
                } catch (error) {
                    console.error('Failed to save settings to server:', error);
                    throw error;
                }
            },

            // Provider credentials
            setProviderCredential: (provider, credentials) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        providerCredentials: {
                            ...state.settings.providerCredentials,
                            [provider]: credentials,
                        },
                    },
                }));
            },

            // Function configuration
            setFunctionConfig: (functionType, config) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        functionConfigs: {
                            ...state.settings.functionConfigs,
                            [functionType]: config,
                        },
                    },
                }));
            },

            setFunctionProvider: (functionType, provider) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        functionConfigs: {
                            ...state.settings.functionConfigs,
                            [functionType]: {
                                ...state.settings.functionConfigs[functionType],
                                provider,
                                // Clear provider preferences if switching away from OpenRouter
                                providerPreference: provider === 'openrouter'
                                    ? state.settings.functionConfigs[functionType].providerPreference
                                    : undefined,
                            },
                        },
                    },
                }));
            },

            setFunctionModel: (functionType, model) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        functionConfigs: {
                            ...state.settings.functionConfigs,
                            [functionType]: {
                                ...state.settings.functionConfigs[functionType],
                                model,
                            },
                        },
                    },
                }));
            },

            setFunctionTemperature: (functionType, temperature) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        functionConfigs: {
                            ...state.settings.functionConfigs,
                            [functionType]: {
                                ...state.settings.functionConfigs[functionType],
                                temperature,
                            },
                        },
                    },
                }));
            },

            setFunctionProviderPreference: (functionType, pref) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        functionConfigs: {
                            ...state.settings.functionConfigs,
                            [functionType]: {
                                ...state.settings.functionConfigs[functionType],
                                providerPreference: pref,
                            },
                        },
                    },
                }));
            },

            setFunctionAdvanced: (functionType, advanced) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        functionConfigs: {
                            ...state.settings.functionConfigs,
                            [functionType]: {
                                ...state.settings.functionConfigs[functionType],
                                advanced: {
                                    ...state.settings.functionConfigs[functionType].advanced,
                                    ...advanced,
                                },
                            },
                        },
                    },
                }));
            },

            // Getters
            getFunctionConfig: (functionType) => {
                return get().settings.functionConfigs[functionType];
            },

            getProviderConfig: (provider) => {
                return get().settings.providerCredentials[provider];
            },

            // Language setters
            setMainLanguage: (language: string) => {
                set((state) => ({
                    settings: { ...state.settings, mainLanguage: language },
                }));
            },

            setSubLanguages: (languages: string[]) => {
                set((state) => {
                    // If default is no longer in the list, update it
                    const newDefault = state.settings.defaultSubLanguage && languages.includes(state.settings.defaultSubLanguage)
                        ? state.settings.defaultSubLanguage
                        : languages[0] || null;
                    return {
                        settings: {
                            ...state.settings,
                            subLanguages: languages,
                            defaultSubLanguage: newDefault,
                        },
                    };
                });
            },

            setDefaultSubLanguage: (language: string | null) => {
                set((state) => ({
                    settings: { ...state.settings, defaultSubLanguage: language },
                }));
            },

            addSubLanguage: (language: string) => {
                set((state) => {
                    if (state.settings.subLanguages.includes(language)) {
                        return state; // Already exists
                    }
                    const newSubLanguages = [...state.settings.subLanguages, language];
                    return {
                        settings: {
                            ...state.settings,
                            subLanguages: newSubLanguages,
                            // Set as default if it's the first one
                            defaultSubLanguage: state.settings.defaultSubLanguage || language,
                        },
                    };
                });
            },

            removeSubLanguage: (language: string) => {
                set((state) => {
                    const newSubLanguages = state.settings.subLanguages.filter(l => l !== language);
                    // Update default if we removed it
                    const newDefault = state.settings.defaultSubLanguage === language
                        ? newSubLanguages[0] || null
                        : state.settings.defaultSubLanguage;
                    return {
                        settings: {
                            ...state.settings,
                            subLanguages: newSubLanguages,
                            defaultSubLanguage: newDefault,
                        },
                    };
                });
            },

            // Theme setter
            setTheme: (theme) => {
                set((state) => ({
                    settings: { ...state.settings, theme },
                }));
            },

            updateSettings: (updates) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        ...updates,
                    },
                }));
            },

            resetToDefaults: () => {
                set({ settings: { ...defaultSettings } });
            },

            // Prompt methods
            loadPrompt: async (functionType, category, name?) => {
                const key = getPromptKey(functionType, category, name);

                try {
                    // Try to load from backend
                    const promptData = await promptService.getPrompt(functionType, category, name);

                    // Cache the content
                    const cache = get().promptCache;
                    cache.set(key, promptData.content);
                    set({ promptCache: new Map(cache) });

                    return promptData.content;
                } catch (error) {
                    console.error(`Failed to load prompt from backend: ${key}`, error);
                    throw error;
                }
            },

            getPromptFromCache: (functionType, category, name?) => {
                const key = getPromptKey(functionType, category, name);
                return get().promptCache.get(key) || null;
            },

            invalidatePromptCache: (functionType?, category?, name?) => {
                if (!functionType) {
                    // Clear all cache
                    set({ promptCache: new Map() });
                    return;
                }

                const key = getPromptKey(functionType, category!, name);
                const cache = get().promptCache;
                cache.delete(key);
                set({ promptCache: new Map(cache) });
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
            merge: (persistedState: any, currentState: SettingsStore) => {
                // Merge persisted settings with defaults for backward compatibility
                return {
                    ...currentState,
                    settings: mergeWithDefaults(persistedState?.settings),
                    lastSyncedAt: persistedState?.lastSyncedAt ?? null,
                };
            },
        }
    )
);

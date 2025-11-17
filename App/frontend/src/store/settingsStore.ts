import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsService } from '../api/settingsService';
import { promptService } from '../api/promptService';
import type { FunctionType, PromptCategory } from '../prompts/defaults';
import { getDefaultPrompt, getPromptKey } from '../prompts/defaults';

// Types
export type ProviderType = 'copilot' | 'openrouter' | 'custom';
export type AIFunctionType = 'chat' | 'translation' | 'batchTranslation' | 'storyEdit' | 'chapterGen';
export type ThemeMode = 'light' | 'dark' | 'system';

// Generic provider config (for API requests)
export interface ProviderConfig {
    apiKey?: string;
    baseUrl?: string;
    additionalHeaders?: Record<string, string>;
}

// Provider configurations (credentials only - shared across functions)
export interface ProviderCredentials {
    copilot: {};
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

// Reasoning configuration for model-native reasoning (OpenRouter)
export interface ReasoningConfig {
    effort?: 'low' | 'medium' | 'high';
    maxTokens?: number;
}

// Advanced settings for AI functions
export interface AdvancedFunctionSettings {
    enablePrefill: boolean;
    thinkingMode: 'off' | 'model' | 'custom';
    reasoningConfig?: ReasoningConfig;
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
    primaryLanguage: string;
    secondaryLanguage: string | null;

    // Theme settings
    theme: ThemeMode;
}

// Default settings
const defaultSettings: Settings = {
    providerCredentials: {
        copilot: {},
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
            provider: 'copilot',
            model: 'gpt-4o-mini',
            temperature: 0.7,
            advanced: {
                enablePrefill: false,
                thinkingMode: 'off',
                reasoningConfig: {
                    effort: 'medium',
                },
            },
        },

        // Translation: Accurate for language translation
        translation: {
            provider: 'copilot',
            model: 'gpt-4o',
            temperature: 0.2,
            advanced: {
                enablePrefill: false,
                thinkingMode: 'off',
                reasoningConfig: {
                    effort: 'medium',
                },
            },
        },

        // Batch Translation: Consistent batch translation
        batchTranslation: {
            provider: 'copilot',
            model: 'gpt-4o',
            temperature: 0.2,
            advanced: {
                enablePrefill: false,
                thinkingMode: 'off',
                reasoningConfig: {
                    effort: 'medium',
                },
            },
        },

        // Story Edit: Good at structured editing
        storyEdit: {
            provider: 'copilot',
            model: 'gpt-4o',
            temperature: 0.3,
            advanced: {
                enablePrefill: false,
                thinkingMode: 'off',
                reasoningConfig: {
                    effort: 'medium',
                },
            },
        },

        // Chapter Gen: Creative writing
        chapterGen: {
            provider: 'copilot',
            model: 'gpt-4o',
            temperature: 0.7,
            advanced: {
                enablePrefill: true,
                thinkingMode: 'off',
                reasoningConfig: {
                    effort: 'medium',
                },
            },
        },
    },

    primaryLanguage: 'English',
    secondaryLanguage: null,

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
    setPrimaryLanguage: (language: string) => void;
    setSecondaryLanguage: (language: string | null) => void;

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

// Helper to migrate old settings format
const migrateAdvancedSettings = (advanced: any): AdvancedFunctionSettings => {
    // Handle old enableThinking boolean -> new thinkingMode
    if ('enableThinking' in advanced && !('thinkingMode' in advanced)) {
        return {
            enablePrefill: advanced.enablePrefill ?? false,
            thinkingMode: advanced.enableThinking ? 'custom' : 'off',
            reasoningConfig: advanced.reasoningConfig ?? {
                effort: 'medium',
            },
        };
    }

    // Ensure reasoningConfig exists
    return {
        ...advanced,
        reasoningConfig: advanced.reasoningConfig ?? {
            effort: 'medium',
        },
    };
};

// Helper to merge stored settings with defaults (for backward compatibility)
const mergeWithDefaults = (stored: any): Settings => {
    if (!stored || typeof stored !== 'object') {
        return defaultSettings;
    }

    // Migrate function configs
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
        primaryLanguage: stored.primaryLanguage ?? defaultSettings.primaryLanguage,
        secondaryLanguage: stored.secondaryLanguage ?? defaultSettings.secondaryLanguage,
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
            setPrimaryLanguage: (language) => {
                set((state) => ({
                    settings: { ...state.settings, primaryLanguage: language },
                }));
            },

            setSecondaryLanguage: (language) => {
                set((state) => ({
                    settings: { ...state.settings, secondaryLanguage: language },
                }));
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
                    console.error('Failed to load prompt from backend, using default:', error);

                    // Fallback to bundled default
                    const defaultContent = getDefaultPrompt(functionType, category, name);
                    if (defaultContent) {
                        // Check if any versions exist
                        try {
                            const versions = await promptService.getVersionHistory(functionType, category, name);

                            // If no versions exist, auto-save the default as version 1
                            if (versions.length === 0) {
                                console.log('No versions found, auto-saving default preset as version 1');
                                await promptService.savePrompt(
                                    functionType,
                                    category,
                                    defaultContent,
                                    'Initial default preset',
                                    name
                                );
                            }
                        } catch (saveError) {
                            console.error('Failed to auto-save default preset:', saveError);
                            // Continue even if auto-save fails - user can still use the default
                        }

                        const cache = get().promptCache;
                        cache.set(key, defaultContent);
                        set({ promptCache: new Map(cache) });
                        return defaultContent;
                    }

                    throw new Error(`No prompt found for ${key}`);
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

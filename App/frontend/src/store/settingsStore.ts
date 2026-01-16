import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { settingsService } from '../api/settingsService';
import { promptService } from '../api/promptService';
import type { FunctionType, PromptCategory } from '../types/prompts';
import { getPromptKey } from '../types/prompts';

// Types
export type ProviderType = 'openai' | 'gemini' | 'claude' | 'openrouter' | 'custom' | 'xai';
export type AIFunctionType = 'agent' | 'translation' | 'editAssistant' | 'imagePrompt';
export type ImageProviderType = 'openai' | 'gemini' | 'xai' | 'novelai';
export type PromptType = 'natural' | 'tag_based';
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
    xai: {
        apiKey: string;
    };
    novelai: {
        apiKey: string;  // JWT access token
    };
}

// OpenRouter provider preference
export interface ProviderPreference {
    only?: string[];
    ignore?: string[];
}

// Custom API format for custom endpoints (controls both thinking and function calling)
export type CustomApiFormat = 'openai' | 'claude' | 'gemini' | 'openrouter';

// Thinking configuration for model-native thinking
export interface ThinkingConfig {
    effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';  // GPT-5.2+ supports minimal/xhigh
    maxTokens?: number;
    verbosity?: 'low' | 'medium' | 'high';  // GPT-5 output verbosity
    claudeBudgetTokens?: number;
    geminiThinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';  // Gemini 3 Flash supports all, Pro only low/high
    geminiBudgetTokens?: number;
}

// Retry configuration for error handling
export interface RetryConfig {
    enabled: boolean;                  // Enable/disable retry logic
    maxRetries: number;                // Number of retry attempts (0-10)
    retryableStatusCodes: number[];    // HTTP status codes to retry on
    retryDelayMs: number;              // Delay between retries in ms
}

// Advanced settings for AI functions
export interface AdvancedFunctionSettings {
    enablePrefill: boolean;
    thinkingMode: 'off' | 'model' | 'custom';
    thinkingConfig?: ThinkingConfig;
    customApiFormat?: CustomApiFormat;  // For custom endpoint API format (affects thinking + function calling)
}

// Complete configuration for a single AI function
export interface FunctionAIConfig {
    provider: ProviderType;
    model: string;
    temperature: number;
    providerPreference?: ProviderPreference;
    advanced: AdvancedFunctionSettings;
}

// Custom image style for natural language providers (prefix/postfix)
export interface NaturalImageStyle {
    id: string;
    name: string;
    prefix: string;   // Prepended to prompt
    postfix: string;  // Appended to prompt
}

// Custom image style for tag-based providers (prefix/postfix for positive and negative prompts)
export interface TagBasedImageStyle {
    id: string;
    name: string;
    positivePrefix: string;   // Prepended to positive prompt
    positivePostfix: string;  // Appended to positive prompt
    negativePrefix: string;   // Prepended to negative prompt
    negativePostfix: string;  // Appended to negative prompt
}


// NovelAI-specific settings
export interface NovelAIImageSettings {
    sampler: string;
    steps: number;
    scale: number;        // CFG Scale
    noise_schedule: string;
}

// OpenAI-specific settings
export interface OpenAIImageSettings {
    quality: 'standard' | 'hd';
    style: 'natural' | 'vivid';
}

// Gemini-specific settings (uses aspect_ratio + image_size, not pixel dimensions)
export interface GeminiImageSettings {
    aspect_ratio: string;     // "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"
    image_resolution: string; // "1K", "2K", "4K"
}

// Image generation configuration
export interface ImageGenConfig {
    provider: ImageProviderType;
    model: string;
    size: string;

    // Separate custom styles per prompt type
    naturalStyles: NaturalImageStyle[];      // For OpenAI, Gemini, xAI
    tagBasedStyles: TagBasedImageStyle[];    // For NovelAI
    selectedNaturalStyleId: string | null;
    selectedTagBasedStyleId: string | null;

    // Per-provider settings
    openaiSettings: OpenAIImageSettings;
    geminiSettings: GeminiImageSettings;
    novelaiSettings: NovelAIImageSettings;
}

// Main settings interface
export interface Settings {
    // Shared provider credentials
    providerCredentials: ProviderCredentials;

    // Per-function complete configurations
    functionConfigs: {
        [K in AIFunctionType]: FunctionAIConfig;
    };

    // Image generation configuration
    imageGenConfig: ImageGenConfig;

    // Language settings
    mainLanguage: string;
    subLanguages: string[];
    defaultSubLanguage: string | null;
    displayLanguage: string; // Currently active display language (defaults to mainLanguage)

    // Theme settings
    theme: ThemeMode;

    // Retry configuration (global)
    retryConfig: RetryConfig;

    // Native output mode - skip function calling and output raw text/XML
    nativeOutputMode: boolean;

    // LLM request logging - enable logging of LLM requests for debugging
    llmLoggingEnabled: boolean;

    // Function call history limit - how many recent assistant messages to include function calls for
    // 0 = none, 1-10 = last N messages, -1 = all
    functionCallHistoryLimit: number;

    // Thinking history limit - how many recent assistant messages to include thinking for
    // 0 = none, 1-10 = last N messages, -1 = all
    thinkingHistoryLimit: number;
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
        xai: {
            apiKey: '',
        },
        novelai: {
            apiKey: '',
        },
    },

    functionConfigs: {
        // Agent: Fast and cheap for conversation
        agent: {
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

        // Edit Assistant: Unified editing for manuscripts and story objects
        editAssistant: {
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

        // Image Prompt: AI-assisted prompt generation for images
        imagePrompt: {
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
    },

    // Image generation defaults
    imageGenConfig: {
        provider: 'openai',
        model: 'gpt-image-1',
        size: '1024x1024',

        // Separate styles per prompt type
        naturalStyles: [],
        tagBasedStyles: [],
        selectedNaturalStyleId: null,
        selectedTagBasedStyleId: null,

        // Per-provider settings
        openaiSettings: {
            quality: 'standard',
            style: 'natural',
        },
        geminiSettings: {
            aspect_ratio: '1:1',
            image_resolution: '2K',
        },
        novelaiSettings: {
            sampler: 'k_euler_ancestral',
            steps: 28,
            scale: 6,
            noise_schedule: 'karras',
        },
    },

    mainLanguage: 'English',
    subLanguages: [],
    defaultSubLanguage: null,
    displayLanguage: 'English', // Defaults to mainLanguage

    // Default to system theme preference
    theme: 'system',

    // Default retry configuration
    retryConfig: {
        enabled: true,
        maxRetries: 3,
        retryableStatusCodes: [429, 500, 502, 503, 504],
        retryDelayMs: 1000,
    },

    // Native output mode disabled by default
    nativeOutputMode: false,

    // LLM logging disabled by default
    llmLoggingEnabled: false,

    // Function call history limit - include function calls from last 5 assistant messages by default
    functionCallHistoryLimit: 5,

    // Thinking history limit - include thinking from last 5 assistant messages by default
    thinkingHistoryLimit: 5,
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

    // Image generation config setters
    setImageGenConfig: (config: Partial<ImageGenConfig>) => void;

    // Language setters
    setMainLanguage: (language: string) => void;
    setSubLanguages: (languages: string[]) => void;
    setDefaultSubLanguage: (language: string | null) => void;
    setDisplayLanguage: (language: string) => void;
    addSubLanguage: (language: string) => void;
    removeSubLanguage: (language: string) => void;

    // Theme setter
    setTheme: (theme: ThemeMode) => void;

    // Native output mode setter
    setNativeOutputMode: (enabled: boolean) => void;

    // LLM logging setter
    setLLMLoggingEnabled: (enabled: boolean) => void;

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
    customApiFormat: advanced.customApiFormat ?? 'openai',
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
        imageGenConfig: {
            ...defaultSettings.imageGenConfig,
            ...stored.imageGenConfig,
            naturalStyles: stored.imageGenConfig?.naturalStyles ?? [],
            tagBasedStyles: stored.imageGenConfig?.tagBasedStyles ?? [],
            selectedNaturalStyleId: stored.imageGenConfig?.selectedNaturalStyleId ?? null,
            selectedTagBasedStyleId: stored.imageGenConfig?.selectedTagBasedStyleId ?? null,
            // Ensure provider settings exist
            openaiSettings: {
                ...defaultSettings.imageGenConfig.openaiSettings,
                ...stored.imageGenConfig?.openaiSettings,
            },
            geminiSettings: {
                ...defaultSettings.imageGenConfig.geminiSettings,
                ...stored.imageGenConfig?.geminiSettings,
            },
            novelaiSettings: {
                ...defaultSettings.imageGenConfig.novelaiSettings,
                ...stored.imageGenConfig?.novelaiSettings,
            },
        },
        mainLanguage: stored.mainLanguage ?? defaultSettings.mainLanguage,
        subLanguages: stored.subLanguages ?? defaultSettings.subLanguages,
        defaultSubLanguage: stored.defaultSubLanguage ?? defaultSettings.defaultSubLanguage,
        displayLanguage: stored.displayLanguage ?? stored.mainLanguage ?? defaultSettings.mainLanguage,
        theme: stored.theme ?? defaultSettings.theme,
        retryConfig: {
            ...defaultSettings.retryConfig,
            ...stored.retryConfig,
        },
        nativeOutputMode: stored.nativeOutputMode ?? defaultSettings.nativeOutputMode,
        llmLoggingEnabled: stored.llmLoggingEnabled ?? defaultSettings.llmLoggingEnabled,
        functionCallHistoryLimit: stored.functionCallHistoryLimit ?? defaultSettings.functionCallHistoryLimit,
        thinkingHistoryLimit: stored.thinkingHistoryLimit ?? defaultSettings.thinkingHistoryLimit,
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

            // Image generation config
            setImageGenConfig: (config) => {
                set((state) => ({
                    settings: {
                        ...state.settings,
                        imageGenConfig: {
                            ...state.settings.imageGenConfig,
                            ...config,
                        },
                    },
                }));
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

            setDisplayLanguage: (language: string) => {
                set((state) => ({
                    settings: { ...state.settings, displayLanguage: language },
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

            // Native output mode setter
            setNativeOutputMode: (enabled) => {
                set((state) => ({
                    settings: { ...state.settings, nativeOutputMode: enabled },
                }));
            },

            // LLM logging setter
            setLLMLoggingEnabled: (enabled) => {
                set((state) => ({
                    settings: { ...state.settings, llmLoggingEnabled: enabled },
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

import { create } from 'zustand';
import { settingsService } from '../api/settingsService';
import { promptService } from '../api/promptService';
import type { TaskType, PromptCategory } from '../types/prompts';
import { getPromptKey } from '../types/prompts';

// Types
export type ProviderType = 'openai' | 'gemini' | 'claude' | 'openrouter' | 'custom' | 'xai';
export type AITaskType = 'agent' | 'translation' | 'editAssistant' | 'imagePrompt' | 'summary' | 'subAgent';
export type ImageProviderType = 'openai' | 'gemini' | 'xai' | 'novelai';
export type PromptType = 'natural' | 'tag_based';
export type ThemeMode = 'light' | 'dark' | 'system';

// Supported UI languages for interface localization
export const SUPPORTED_UI_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'ko', name: '한국어' },
] as const;

export type UILanguageCode = typeof SUPPORTED_UI_LANGUAGES[number]['code'];

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

// Custom API format for custom endpoints (controls both thinking and tool calling)
export type CustomApiFormat = 'openai' | 'claude' | 'gemini';

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

// Tool call auto-approve configuration (confirmation bypass)
export interface ToolCallAutoApproveConfig {
    create: boolean;
    delete: boolean;
    patch: boolean;
    replace: boolean;
    read: boolean;
    search: boolean;
}

// Tokenizer type for token counting (used with openrouter/custom providers)
export type TokenizerOverride = 'openai' | 'claude' | 'gemini';

// Advanced settings for AI functions
export interface AdvancedTaskSettings {
    enablePrefill: boolean;
    thinkingMode: 'off' | 'model' | 'custom';
    thinkingConfig?: ThinkingConfig;
    customApiFormat?: CustomApiFormat;  // OpenAI-compatible dialect for custom endpoints
    tokenizerOverride?: TokenizerOverride;  // For openrouter/custom providers: which tokenizer to use for token counting
}

// Complete configuration for a single AI function
export interface TaskAIConfig {
    provider: ProviderType;
    model: string;
    temperature: number;
    providerPreference?: ProviderPreference;
    // Max output tokens for the LLM response (maps to backend `max_tokens`)
    // If omitted, provider defaults are used.
    maxOutputTokens?: number;
    // Context window upper bound (used for local budgeting like agent memory preflight)
    // If omitted, falls back to conservative defaults.
    contextWindowTokens?: number;
    advanced: AdvancedTaskSettings;
}

// Embedding profile configuration (used by RAG Search / Agent Memory)
export interface EmbeddingProfileConfig {
    provider: ProviderType;
    model: string;
    dimensions?: number | null;
}

export interface EmbeddingConfigs {
    ragSearch: EmbeddingProfileConfig;
    agentMemory: EmbeddingProfileConfig;
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
    // Per-function complete configurations
    taskConfigs: {
        [K in AITaskType]: TaskAIConfig;
    };

    // Image generation configuration
    imageGenConfig: ImageGenConfig;

    // Language settings
    mainLanguage: string;
    subLanguages: string[];
    defaultSubLanguage: string | null;
    uiLanguage: UILanguageCode; // UI localization language (i18next)

    // Theme settings
    theme: ThemeMode;

    // Retry configuration (global)
    retryConfig: RetryConfig;

    // Native output mode - skip tool calling and output raw text/XML
    nativeOutputMode: boolean;

    // RAG Search - enable embeddings-based search/indexing
    ragSearchEnabled: boolean;

    // Embedding profiles by feature
    embeddingConfigs: EmbeddingConfigs;

    // RAG Search defaults (tool + formatting)
    ragSearchTopKPerQuery: number;
    ragSearchNeighborWindow: number;
    ragSearchMaxPrimaryChunks: number;
    ragSearchMaxTotalChunks: number;
    ragSearchKeywordPageSize: number;

    // Agent Memory search defaults (for relevantChats injection)
    agentMemoryTopKPerQuery: number;
    agentMemoryNeighborWindow: number;
    agentMemoryMaxPrimaryMessages: number;
    agentMemoryMaxTotalMessages: number;

    // LLM request logging - enable logging of LLM requests for debugging
    llmLoggingEnabled: boolean;

    // Tool call history limit - how many recent assistant messages to include tool calls for
    // 0 = none, 1-10 = last N messages, -1 = all
    toolCallHistoryLimit: number;

    // Thinking history limit - how many recent assistant messages to include thinking for
    // 0 = none, 1-10 = last N messages, -1 = all
    thinkingHistoryLimit: number;

    // Tool call auto-approve settings (all-or-none per assistant response)
    toolCallAutoApprove: ToolCallAutoApproveConfig;
}

export type SettingsLoadStatus = 'idle' | 'loading' | 'ready' | 'error';

const SETTINGS_NOT_LOADED_ERROR =
    'Settings are not loaded. Make sure you are in an authenticated route and settings have been loaded from the server.';

const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    return 'Unknown error';
};

const requireSettings = (settings: Settings | null): Settings => {
    if (!settings) {
        throw new Error(SETTINGS_NOT_LOADED_ERROR);
    }
    return settings;
};

// Store interface
export interface SettingsStore {
    settings: Settings | null;
    status: SettingsLoadStatus;
    error: string | null;
    lastSyncedAt: string | null;

    // Prompt cache
    promptCache: Map<string, string>;

    // Helpers
    getSettings: () => Settings;
    clearSettings: () => void;

    // Sync methods
    loadFromServer: () => Promise<void>;
    saveToServer: () => Promise<void>;

    // Function config setters
    setTaskConfig: (functionType: AITaskType, config: TaskAIConfig) => void;
    setTaskProvider: (functionType: AITaskType, provider: ProviderType) => void;
    setTaskModel: (functionType: AITaskType, model: string) => void;
    setTaskTemperature: (functionType: AITaskType, temperature: number) => void;
    setTaskProviderPreference: (functionType: AITaskType, pref?: ProviderPreference) => void;
    setTaskAdvanced: (functionType: AITaskType, advanced: Partial<AdvancedTaskSettings>) => void;

    // Getters
    getTaskConfig: (functionType: AITaskType) => TaskAIConfig;

    // Image generation config setters
    setImageGenConfig: (config: Partial<ImageGenConfig>) => void;

    // Language setters
    setMainLanguage: (language: string) => void;
    setSubLanguages: (languages: string[]) => void;
    setDefaultSubLanguage: (language: string | null) => void;
    setUiLanguage: (language: UILanguageCode) => void;
    addSubLanguage: (language: string) => void;
    removeSubLanguage: (language: string) => void;

    // Theme setter
    setTheme: (theme: ThemeMode) => void;

    // Native output mode setter
    setNativeOutputMode: (enabled: boolean) => void;

    // LLM logging setter
    setLLMLoggingEnabled: (enabled: boolean) => void;

    // Prompt methods
    loadPrompt: (functionType: TaskType, category: PromptCategory, name: string) => Promise<string>;
    getPromptFromCache: (functionType: TaskType, category: PromptCategory, name: string) => string | null;
    invalidatePromptCache: (functionType?: TaskType, category?: PromptCategory, name?: string) => void;

    // Other methods
    updateSettings: (updates: Partial<Settings>) => void;
}

let inFlightLoad: Promise<void> | null = null;

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
    settings: null,
    status: 'idle',
    error: null,
    lastSyncedAt: null,
    promptCache: new Map<string, string>(),

    getSettings: () => requireSettings(get().settings),
    clearSettings: () => {
        set({
            settings: null,
            status: 'idle',
            error: null,
            lastSyncedAt: null,
            promptCache: new Map<string, string>(),
        });
    },

    // Sync methods
    loadFromServer: async () => {
        if (get().status === 'ready') {
            return;
        }

        if (inFlightLoad) {
            return await inFlightLoad;
        }

        const promise = (async () => {
            set({ status: 'loading', error: null });
            try {
                const serverSettings = await settingsService.getSettings();
                set({
                    settings: serverSettings,
                    lastSyncedAt: new Date().toISOString(),
                    status: 'ready',
                    error: null,
                });
            } catch (error) {
                const message = getErrorMessage(error);
                console.error('Failed to load settings from server:', error);
                set({
                    settings: null,
                    status: 'error',
                    error: message,
                });
                throw error;
            }
        })();

        inFlightLoad = promise;
        try {
            await promise;
        } finally {
            if (inFlightLoad === promise) {
                inFlightLoad = null;
            }
        }
    },

    saveToServer: async () => {
        try {
            const settings = get().getSettings();
            const saved = await settingsService.updateSettings(settings);
            set({ settings: saved, lastSyncedAt: new Date().toISOString() });
        } catch (error) {
            console.error('Failed to save settings to server:', error);
            throw error;
        }
    },

    // Function configuration
    setTaskConfig: (functionType, config) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: {
                    ...settings,
                    taskConfigs: {
                        ...settings.taskConfigs,
                        [functionType]: config,
                    },
                },
            };
        });
    },

    setTaskProvider: (functionType, provider) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: {
                    ...settings,
                    taskConfigs: {
                        ...settings.taskConfigs,
                        [functionType]: {
                            ...settings.taskConfigs[functionType],
                            provider,
                            // Clear provider preferences if switching away from OpenRouter
                            providerPreference:
                                provider === 'openrouter'
                                    ? settings.taskConfigs[functionType].providerPreference
                                    : undefined,
                        },
                    },
                },
            };
        });
    },

    setTaskModel: (functionType, model) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: {
                    ...settings,
                    taskConfigs: {
                        ...settings.taskConfigs,
                        [functionType]: {
                            ...settings.taskConfigs[functionType],
                            model,
                        },
                    },
                },
            };
        });
    },

    setTaskTemperature: (functionType, temperature) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: {
                    ...settings,
                    taskConfigs: {
                        ...settings.taskConfigs,
                        [functionType]: {
                            ...settings.taskConfigs[functionType],
                            temperature,
                        },
                    },
                },
            };
        });
    },

    setTaskProviderPreference: (functionType, pref) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: {
                    ...settings,
                    taskConfigs: {
                        ...settings.taskConfigs,
                        [functionType]: {
                            ...settings.taskConfigs[functionType],
                            providerPreference: pref,
                        },
                    },
                },
            };
        });
    },

    setTaskAdvanced: (functionType, advanced) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: {
                    ...settings,
                    taskConfigs: {
                        ...settings.taskConfigs,
                        [functionType]: {
                            ...settings.taskConfigs[functionType],
                            advanced: {
                                ...settings.taskConfigs[functionType].advanced,
                                ...advanced,
                            },
                        },
                    },
                },
            };
        });
    },

    // Getters
    getTaskConfig: (functionType) => {
        return get().getSettings().taskConfigs[functionType];
    },

    // Image generation config
    setImageGenConfig: (config) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: {
                    ...settings,
                    imageGenConfig: {
                        ...settings.imageGenConfig,
                        ...config,
                    },
                },
            };
        });
    },

    // Language setters
    setMainLanguage: (language: string) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: { ...settings, mainLanguage: language },
            };
        });
    },

    setSubLanguages: (languages: string[]) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            // If default is no longer in the list, update it
            const newDefault =
                settings.defaultSubLanguage && languages.includes(settings.defaultSubLanguage)
                    ? settings.defaultSubLanguage
                    : languages[0] || null;

            return {
                settings: {
                    ...settings,
                    subLanguages: languages,
                    defaultSubLanguage: newDefault,
                },
            };
        });
    },

    setDefaultSubLanguage: (language: string | null) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: { ...settings, defaultSubLanguage: language },
            };
        });
    },

    setUiLanguage: (language: UILanguageCode) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: { ...settings, uiLanguage: language },
            };
        });
    },

    addSubLanguage: (language: string) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            if (settings.subLanguages.includes(language)) {
                return {};
            }
            const newSubLanguages = [...settings.subLanguages, language];
            return {
                settings: {
                    ...settings,
                    subLanguages: newSubLanguages,
                    // Set as default if it's the first one
                    defaultSubLanguage: settings.defaultSubLanguage || language,
                },
            };
        });
    },

    removeSubLanguage: (language: string) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            const newSubLanguages = settings.subLanguages.filter((l) => l !== language);
            // Update default if we removed it
            const newDefault =
                settings.defaultSubLanguage === language
                    ? newSubLanguages[0] || null
                    : settings.defaultSubLanguage;
            return {
                settings: {
                    ...settings,
                    subLanguages: newSubLanguages,
                    defaultSubLanguage: newDefault,
                },
            };
        });
    },

    // Theme setter
    setTheme: (theme) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: { ...settings, theme },
            };
        });
    },

    // Native output mode setter
    setNativeOutputMode: (enabled) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: { ...settings, nativeOutputMode: enabled },
            };
        });
    },

    // LLM logging setter
    setLLMLoggingEnabled: (enabled) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: { ...settings, llmLoggingEnabled: enabled },
            };
        });
    },

    updateSettings: (updates) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: {
                    ...settings,
                    ...updates,
                },
            };
        });
    },

    // Prompt methods
    loadPrompt: async (functionType, category, name) => {
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

    getPromptFromCache: (functionType, category, name) => {
        const key = getPromptKey(functionType, category, name);
        return get().promptCache.get(key) || null;
    },

    invalidatePromptCache: (functionType?, category?, name?) => {
        if (!functionType) {
            // Clear all cache
            set({ promptCache: new Map() });
            return;
        }

        if (!category || !name) {
            throw new Error('invalidatePromptCache requires functionType, category, and name (or no args to clear all)');
        }

        const key = getPromptKey(functionType, category, name);
        const cache = get().promptCache;
        cache.delete(key);
        set({ promptCache: new Map(cache) });
    },
}));

export const useSettings = (): Settings => {
    return useSettingsStore((state) => requireSettings(state.settings));
};

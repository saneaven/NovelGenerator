import { useMemo } from 'react';
import { create } from 'zustand';
import { settingsService } from '../api/settingsService';
import { scenarioService } from '../api/scenarioService';
import { buildDemoScopedSettingsPayload, buildSettingsUpdatePayload } from './settingsUpdatePayload';
import type { ScenarioDocument, TaskType } from '../types/scenarios';
import {
    resolveAllTaskConfigs as resolveStoredTaskConfigs,
    resolveTaskConfig as resolveStoredTaskConfig,
} from './taskConfigSettings';
import type { SearchMemorySettings } from './searchMemorySettings';
import type {
    AITaskType,
    TaskConfigSettings,
} from './taskConfigSettings';
export type {
    AdvancedTaskSettings,
    AITaskType,
    CustomKind,
    ProviderPreference,
    ProviderType,
    TaskAIConfig,
    TaskConfigSettings,
    TokenizerOverride,
    ThinkingConfig,
} from './taskConfigSettings';
export type {
    EmbeddingConfig,
    EmbeddingProviderType,
    MemoryConfig,
    RetrievalConfig,
    SearchGeneralConfig,
    SearchMemorySettings,
    SearchMemoryTarget,
} from './searchMemorySettings';
export {
    hasSearchMemoryOverride,
    makeInitialSearchMemorySettings,
    makeMemoryOverrideSeed,
    makeSearchOverrideSeed,
    resolveMemorySettings,
    resolveSearchSettings,
    validateSearchMemorySettings,
} from './searchMemorySettings';

// Types
export type ImageProviderType = 'openai' | 'gemini' | 'xai' | 'novelai' | 'openrouter';
export type PromptType = 'natural' | 'tag_based';
export type ThemeMode = 'light' | 'dark' | 'system';

// Supported UI languages for interface localization
export const SUPPORTED_UI_LANGUAGES = [
    { code: 'en', name: 'English' },
    { code: 'ko', name: '한국어' },
] as const;

export type UILanguageCode = typeof SUPPORTED_UI_LANGUAGES[number]['code'];

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
        additionalHeadersJson: string;
        additionalBodyJson: string;
    };
    xai: {
        apiKey: string;
    };
    novelai: {
        apiKey: string;  // JWT access token
    };
}

// Custom thinking template types
export interface CustomThinkingEffortField {
    path: string;
    value: string;
}

export interface CustomThinkingResponseField {
    path: string;
    as_var: string;
    is_stream_delta?: boolean;
}

export interface CustomThinkingHistoryField {
    path: string;
    in_var: string;
}

export interface CustomThinkingTemplate {
    id?: string;
    name: string;
    effort_fields: CustomThinkingEffortField[];
    response_fields: CustomThinkingResponseField[];
    history_fields: CustomThinkingHistoryField[];
}

// Retry configuration for error handling
export interface RetryConfig {
    enabled: boolean;                  // Enable/disable retry logic
    maxRetries: number;                // Number of retry attempts (0-10)
    retryableStatusCodes: number[];    // HTTP status codes to retry on
    retryDelayMs: number;              // Delay between retries in ms
}

// Tool call auto-approve configuration (confirmation bypass)
export type ToolCallAutoApproveConfig = Record<string, boolean>;

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
    quality: 'auto' | 'low' | 'medium' | 'high';
    background: 'auto' | 'opaque' | 'transparent';
    output_format: 'png' | 'jpeg' | 'webp';
    output_compression: number;
    input_fidelity: 'low' | 'high';
}

// Image generation configuration
export interface ImageGenConfig {
    provider: ImageProviderType;
    model: string;
    aspect_ratio: string;
    image_size: string;

    // Separate custom styles per prompt type
    naturalStyles: NaturalImageStyle[];      // For OpenAI, Gemini, xAI
    tagBasedStyles: TagBasedImageStyle[];    // For NovelAI
    selectedNaturalStyleId: string | null;
    selectedTagBasedStyleId: string | null;

    // Per-provider settings
    openaiSettings: OpenAIImageSettings;
    novelaiSettings: NovelAIImageSettings;
}

// Main settings interface
export interface Settings {
    taskConfigSettings: TaskConfigSettings;

    // Image generation configuration
    imageGenConfig: ImageGenConfig;

    // Custom thinking templates (for custom provider openai_completion mode)
    customThinkingTemplates: CustomThinkingTemplate[];

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

    // Search & Memory settings
    searchMemorySettings: SearchMemorySettings;

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

    // Demo mode toggle for first-run guided experience
    demoModeEnabled: boolean;
}

export interface SettingsUpdatePayload {
    taskConfigSettings?: TaskConfigSettings;
    imageGenConfig?: ImageGenConfig;
    customThinkingTemplates?: CustomThinkingTemplate[];
    mainLanguage?: string;
    subLanguages?: string[];
    defaultSubLanguage?: string | null;
    uiLanguage?: UILanguageCode;
    theme?: ThemeMode;
    retryConfig?: RetryConfig;
    nativeOutputMode?: boolean;
    searchMemorySettings?: SearchMemorySettings;
    llmLoggingEnabled?: boolean;
    toolCallHistoryLimit?: number;
    thinkingHistoryLimit?: number;
    toolCallAutoApprove?: ToolCallAutoApproveConfig;
    demoModeEnabled?: boolean;
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

    // Scenario cache
    scenarioCache: Map<string, ScenarioDocument>;

    // Helpers
    getSettings: () => Settings;
    clearSettings: () => void;

    // Sync methods
    loadFromServer: () => Promise<void>;
    saveToServer: (settingsOverride?: Settings) => Promise<Settings>;

    // Image generation config setters
    setImageGenConfig: (config: Partial<ImageGenConfig>) => void;

    // Custom thinking templates setter
    setCustomThinkingTemplates: (templates: CustomThinkingTemplate[]) => void;

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

    // Scenario methods
    loadScenario: (taskType: TaskType, taskSubtype: string) => Promise<ScenarioDocument>;
    getScenarioFromCache: (taskType: TaskType, taskSubtype: string) => ScenarioDocument | null;
    invalidateScenarioCache: (taskType?: TaskType, taskSubtype?: string) => void;

    // Other methods
    updateSettings: (updates: Partial<Settings>) => void;
}

let inFlightLoad: Promise<void> | null = null;

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
    settings: null,
    status: 'idle',
    error: null,
    lastSyncedAt: null,
    scenarioCache: new Map<string, ScenarioDocument>(),

    getSettings: () => requireSettings(get().settings),
    clearSettings: () => {
        set({
            settings: null,
            status: 'idle',
            error: null,
            lastSyncedAt: null,
            scenarioCache: new Map<string, ScenarioDocument>(),
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

    saveToServer: async (settingsOverride) => {
        try {
            const settings = settingsOverride ?? get().getSettings();
            const payload = settings.demoModeEnabled
                ? buildDemoScopedSettingsPayload(settings)
                : buildSettingsUpdatePayload(settings);
            const saved = await settingsService.updateSettings(payload);
            set({ settings: saved, lastSyncedAt: new Date().toISOString() });
            return saved;
        } catch (error) {
            console.error('Failed to save settings to server:', error);
            throw error;
        }
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

    setCustomThinkingTemplates: (templates) => {
        set((state) => {
            const settings = requireSettings(state.settings);
            return {
                settings: { ...settings, customThinkingTemplates: templates },
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

    // Scenario methods
    loadScenario: async (taskType, taskSubtype) => {
        const key = `${taskType}:${taskSubtype}`;
        try {
            const scenarioData = await scenarioService.getScenario(taskType, taskSubtype);
            const cache = get().scenarioCache;
            cache.set(key, scenarioData.scenario);
            set({ scenarioCache: new Map(cache) });
            return scenarioData.scenario;
        } catch (error) {
            console.error(`Failed to load scenario from backend: ${key}`, error);
            throw error;
        }
    },

    getScenarioFromCache: (taskType, taskSubtype) => {
        const key = `${taskType}:${taskSubtype}`;
        return get().scenarioCache.get(key) || null;
    },

    invalidateScenarioCache: (taskType?, taskSubtype?) => {
        if (!taskType) {
            set({ scenarioCache: new Map() });
            return;
        }
        if (!taskSubtype) {
            throw new Error('invalidateScenarioCache requires taskType and taskSubtype (or no args to clear all)');
        }
        const key = `${taskType}:${taskSubtype}`;
        const cache = get().scenarioCache;
        cache.delete(key);
        set({ scenarioCache: new Map(cache) });
    },
}));

export const useSettings = (): Settings => {
    return useSettingsStore((state) => requireSettings(state.settings));
};

export const useResolvedTaskConfig = (taskType: AITaskType) => {
    const taskConfigSettings = useSettingsStore((state) => requireSettings(state.settings).taskConfigSettings);
    return useMemo(
        () => resolveStoredTaskConfig(taskConfigSettings, taskType),
        [taskConfigSettings, taskType]
    );
};

export const useResolvedTaskConfigs = () => {
    const taskConfigSettings = useSettingsStore((state) => requireSettings(state.settings).taskConfigSettings);
    return useMemo(
        () => resolveStoredTaskConfigs(taskConfigSettings),
        [taskConfigSettings]
    );
};

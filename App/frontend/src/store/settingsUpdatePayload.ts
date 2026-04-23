import type { Settings, SettingsUpdatePayload } from './settingsStore';

const LOCKED_SETTINGS_FIELDS = [
    'taskConfigSettings',
    'imageGenConfig',
    'customThinkingTemplates',
    'retryConfig',
    'nativeOutputMode',
    'searchMemorySettings',
    'llmCacheSettings',
    'llmLoggingEnabled',
    'toolCallHistoryLimit',
    'thinkingHistoryLimit',
    'toolCallAutoApprove',
] as const;

export function buildSettingsUpdatePayload(settings: Settings): SettingsUpdatePayload {
    return {
        taskConfigSettings: settings.taskConfigSettings,
        imageGenConfig: settings.imageGenConfig,
        customThinkingTemplates: settings.customThinkingTemplates,
        mainLanguage: settings.mainLanguage,
        subLanguages: settings.subLanguages,
        defaultSubLanguage: settings.defaultSubLanguage,
        uiLanguage: settings.uiLanguage,
        theme: settings.theme,
        retryConfig: settings.retryConfig,
        nativeOutputMode: settings.nativeOutputMode,
        searchMemorySettings: settings.searchMemorySettings,
        llmCacheSettings: settings.llmCacheSettings,
        llmLoggingEnabled: settings.llmLoggingEnabled,
        toolCallHistoryLimit: settings.toolCallHistoryLimit,
        thinkingHistoryLimit: settings.thinkingHistoryLimit,
        toolCallAutoApprove: settings.toolCallAutoApprove,
        demoModeEnabled: settings.demoModeEnabled,
    };
}

export function buildDemoScopedSettingsPayload(settings: Settings): SettingsUpdatePayload {
    return {
        mainLanguage: settings.mainLanguage,
        subLanguages: settings.subLanguages,
        defaultSubLanguage: settings.defaultSubLanguage,
        uiLanguage: settings.uiLanguage,
        theme: settings.theme,
        demoModeEnabled: settings.demoModeEnabled,
    };
}

export function buildLockedSectionReset(current: Settings, persisted: Settings): Settings {
    const next = { ...current };
    for (const field of LOCKED_SETTINGS_FIELDS) {
        (next as Record<string, unknown>)[field] = persisted[field];
    }
    return next;
}

import { apiClient } from './client';
import type { Settings } from '../store/settingsStore';

export interface SettingsSyncResponse {
    taskConfigs: Settings['taskConfigs'];
    mainLanguage: string;
    subLanguages: string[];
    defaultSubLanguage: string | null;
    theme: string;
    retryConfig: Settings['retryConfig'];
    imageGenConfig: Settings['imageGenConfig'];
    nativeOutputMode: boolean;
}

export const settingsService = {
    /**
     * Fetch settings from server
     */
    async getSettings(): Promise<SettingsSyncResponse> {
        return await apiClient.get<SettingsSyncResponse>('/api/v1/settings');
    },

    /**
     * Update all settings on server
     */
    async updateSettings(settings: Partial<Settings>): Promise<SettingsSyncResponse> {
        return await apiClient.put<SettingsSyncResponse>('/api/v1/settings', settings);
    },

    /**
     * Update a specific task's configuration
     */
    async updateTaskConfig(
        taskType: 'agent' | 'translation' | 'editAssistant' | 'imagePrompt',
        config: Settings['taskConfigs']['agent']
    ): Promise<SettingsSyncResponse> {
        return await apiClient.patch<SettingsSyncResponse>(
            `/api/v1/settings/task/${taskType}`,
            config
        );
    },

    /**
     * Sync local settings to server
     */
    async syncToServer(settings: Settings): Promise<{ status: string; updated_at: string }> {
        return await apiClient.post('/api/v1/settings/sync', settings);
    },
};

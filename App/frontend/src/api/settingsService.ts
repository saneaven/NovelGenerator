import { apiClient } from './client';
import type { Settings } from '../store/settingsStore';

export interface SettingsSyncResponse {
    functionConfigs: Settings['functionConfigs'];
    providerCredentials: Settings['providerCredentials'];
    mainLanguage: string;
    subLanguages: string[];
    defaultSubLanguage: string | null;
    theme: string;
    retryConfig: Settings['retryConfig'];
    imageGenConfig: Settings['imageGenConfig'];
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
     * Update a specific function's configuration
     */
    async updateFunctionConfig(
        functionType: 'chat' | 'translation' | 'storyEdit' | 'chapterGen',
        config: Settings['functionConfigs']['chat']
    ): Promise<SettingsSyncResponse> {
        return await apiClient.patch<SettingsSyncResponse>(
            `/api/v1/settings/function/${functionType}`,
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

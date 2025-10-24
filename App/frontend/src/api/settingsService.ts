import { apiClient } from './client';
import type { Settings } from '../store/settingsStore';

export interface SettingsSyncResponse {
    functionConfigs: Settings['functionConfigs'];
    providerCredentials: Settings['providerCredentials'];
    primaryLanguage: string;
    secondaryLanguage: string | null;
    enablePrefill: boolean;
    enableThinking: boolean;
}

export const settingsService = {
    /**
     * Fetch settings from server
     */
    async getSettings(): Promise<SettingsSyncResponse> {
        const response = await apiClient.get<SettingsSyncResponse>('/api/v1/settings');
        return response.data;
    },

    /**
     * Update all settings on server
     */
    async updateSettings(settings: Partial<Settings>): Promise<SettingsSyncResponse> {
        const response = await apiClient.put<SettingsSyncResponse>('/api/v1/settings', settings);
        return response.data;
    },

    /**
     * Update a specific function's configuration
     */
    async updateFunctionConfig(
        functionType: 'chat' | 'translation' | 'storyEdit' | 'chapterGen',
        config: Settings['functionConfigs']['chat']
    ): Promise<SettingsSyncResponse> {
        const response = await apiClient.patch<SettingsSyncResponse>(
            `/api/v1/settings/function/${functionType}`,
            config
        );
        return response.data;
    },

    /**
     * Sync local settings to server
     */
    async syncToServer(settings: Settings): Promise<{ status: string; updated_at: string }> {
        const response = await apiClient.post('/api/v1/settings/sync', settings);
        return response.data;
    },
};

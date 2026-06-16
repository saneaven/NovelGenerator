import { apiClient } from './client';
import type { Settings, SettingsUpdatePayload } from '../domain/settings';

export const settingsService = {
    /**
     * Fetch settings from server
     */
    async getSettings(): Promise<Settings> {
        return await apiClient.get<Settings>('/api/v1/settings');
    },

    /**
     * Update all settings on server
     */
    async updateSettings(settings: SettingsUpdatePayload): Promise<Settings> {
        return await apiClient.put<Settings>('/api/v1/settings', settings);
    },
};

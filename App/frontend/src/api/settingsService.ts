import { apiClient } from './client';
import type { Settings, AITaskType, TaskAIConfig } from '../store/settingsStore';

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
    async updateSettings(settings: Partial<Settings>): Promise<Settings> {
        return await apiClient.put<Settings>('/api/v1/settings', settings);
    },

    /**
     * Update a specific task's configuration
     */
    async updateTaskConfig(
        taskType: AITaskType,
        config: TaskAIConfig
    ): Promise<Settings> {
        return await apiClient.patch<Settings>(
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

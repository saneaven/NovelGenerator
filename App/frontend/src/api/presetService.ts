/**
 * API service for prompt preset management
 */
import { apiClient } from './client';
import type {
  PresetListItem,
  PresetResponse,
  PresetDetailResponse,
  ActivePresetResponse,
  PresetCreate,
  PresetUpdate,
  PresetDuplicateRequest,
  PresetExportData,
  PresetImportRequest,
} from '../types/presets';

const BASE_PATH = '/api/v1/presets';

export const presetService = {
  /**
   * Get all presets for the current user
   */
  async getAllPresets(): Promise<PresetListItem[]> {
    return await apiClient.get<PresetListItem[]>(BASE_PATH);
  },

  /**
   * Get a single preset by ID
   */
  async getPreset(id: string): Promise<PresetDetailResponse> {
    return await apiClient.get<PresetDetailResponse>(`${BASE_PATH}/${encodeURIComponent(id)}`);
  },

  /**
   * Get the active preset
   */
  async getActivePreset(): Promise<ActivePresetResponse> {
    return await apiClient.get<ActivePresetResponse>(`${BASE_PATH}/active`);
  },

  /**
   * Set the active preset
   */
  async setActivePreset(presetId: string): Promise<{ message: string }> {
    return await apiClient.post<{ message: string }>(`${BASE_PATH}/active/${encodeURIComponent(presetId)}`);
  },

  /**
   * Create a new preset
   */
  async createPreset(data: PresetCreate): Promise<PresetResponse> {
    return await apiClient.post<PresetResponse>(BASE_PATH, data);
  },

  /**
   * Duplicate an existing preset
   */
  async duplicatePreset(presetId: string, data: PresetDuplicateRequest): Promise<PresetResponse> {
    return await apiClient.post<PresetResponse>(
      `${BASE_PATH}/${encodeURIComponent(presetId)}/duplicate`,
      data
    );
  },

  /**
   * Update preset metadata
   */
  async updatePreset(presetId: string, data: PresetUpdate): Promise<PresetResponse> {
    return await apiClient.put<PresetResponse>(
      `${BASE_PATH}/${encodeURIComponent(presetId)}`,
      data
    );
  },

  /**
   * Delete a preset
   */
  async deletePreset(presetId: string): Promise<void> {
    await apiClient.delete(`${BASE_PATH}/${encodeURIComponent(presetId)}`);
  },

  /**
   * Export a preset as JSON
   */
  async exportPreset(presetId: string): Promise<PresetExportData> {
    return await apiClient.get<PresetExportData>(
      `${BASE_PATH}/${encodeURIComponent(presetId)}/export`
    );
  },

  /**
   * Import a preset from JSON data
   */
  async importPreset(data: PresetImportRequest): Promise<PresetResponse> {
    return await apiClient.post<PresetResponse>(`${BASE_PATH}/import`, data);
  },
};

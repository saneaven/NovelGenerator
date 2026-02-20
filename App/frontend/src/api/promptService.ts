/**
 * API service for prompt management
 */
import { apiClient } from './client';
import type { TaskType, PromptCategory } from '../types/prompts';

export interface PromptContent {
  content: string;
  version_number: number;
  created_at: string;
  is_system_default: boolean;
}

export interface PromptVersion {
  id: string;
  version_number: number;
  content: string;
  is_system_default: boolean;
  created_at: string;
  note?: string;
}

export interface VersionHistoryItem {
  version_number: number;
  created_at: string;
  note: string | null;
  is_system_default: boolean;
  preview: string;
}

export interface ValidationError {
  line?: number;
  column?: number;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

/**
 * Build API path for prompt
 */
function buildPromptPath(
  taskType: TaskType,
  taskSubtype: string,
  category: PromptCategory,
): string {
  if (!taskSubtype) {
    throw new Error(`Task subtype is required for ${taskType}/${category}`);
  }
  return `/api/v1/prompts/${taskType}/${taskSubtype}/${category}`;
}

export const promptService = {
  /**
   * Get active prompt content
   */
  async getPrompt(
    taskType: TaskType,
    taskSubtype: string,
    category: PromptCategory,
  ): Promise<PromptContent> {
    const path = buildPromptPath(taskType, taskSubtype, category);
    return await apiClient.get<PromptContent>(path);
  },

  /**
   * Save new version of a prompt
   */
  async savePrompt(
    taskType: TaskType,
    taskSubtype: string,
    category: PromptCategory,
    content: string,
    note?: string,
  ): Promise<PromptVersion> {
    const path = buildPromptPath(taskType, taskSubtype, category);
    return await apiClient.post<PromptVersion>(`${path}/save`, {
      content,
      note,
    });
  },

  /**
   * Get version history for a prompt
   */
  async getVersionHistory(
    taskType: TaskType,
    taskSubtype: string,
    category: PromptCategory,
  ): Promise<VersionHistoryItem[]> {
    const path = buildPromptPath(taskType, taskSubtype, category);
    return await apiClient.get<VersionHistoryItem[]>(`${path}/versions`);
  },

  /**
   * Restore a specific version by creating a new version with the restored content
   */
  async restoreVersion(
    taskType: TaskType,
    taskSubtype: string,
    category: PromptCategory,
    versionNumber: number,
  ): Promise<{ new_version: number }> {
    const path = buildPromptPath(taskType, taskSubtype, category);
    return await apiClient.post<{ new_version: number }>(`${path}/restore`, {
      version_number: versionNumber,
    });
  },
};

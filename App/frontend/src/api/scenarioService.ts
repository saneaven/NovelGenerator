/**
 * API service for scenario (Scenario v1 / Blocks Runtime) management
 */
import { apiClient } from './client';
import type { ScenarioDocument, TaskType } from '../types/scenarios';

export interface ScenarioContent {
  scenario: ScenarioDocument;
  version_number: number;
  created_at: string;
  is_system_default: boolean;
}

export interface ScenarioSaveResult {
  id: string;
  version_number: number;
  created_at: string;
  is_system_default: boolean;
  warnings: string[];
  scenario: ScenarioDocument;
}

export interface ScenarioVersionHistoryItem {
  version_number: number;
  created_at: string;
  note: string | null;
  is_system_default: boolean;
  preview: string;
}

export interface ScenarioRestoreResult {
  success: boolean;
  restored_from: number;
  new_version: number;
}

export interface ScenarioSimulatePayload {
  task_type: string;
  task_subtype: string;
  scenario: ScenarioDocument;
  source_conversation: Array<Record<string, any>>;
  template_data: Record<string, any>;
}

export interface ScenarioSimulateResult {
  rendered_system_prompt: string;
  rendered_conversation: Array<Record<string, any>>;
  prefill: string | null;
  memory_template: string | null;
}

function buildScenarioPath(taskType: TaskType, taskSubtype: string): string {
  if (!taskSubtype) {
    throw new Error(`Task subtype is required for ${taskType}`);
  }
  return `/api/v1/scenarios/${taskType}/${taskSubtype}`;
}

export const scenarioService = {
  async getScenario(taskType: TaskType, taskSubtype: string): Promise<ScenarioContent> {
    const path = buildScenarioPath(taskType, taskSubtype);
    return await apiClient.get<ScenarioContent>(path);
  },

  async saveScenario(
    taskType: TaskType,
    taskSubtype: string,
    scenario: ScenarioDocument,
    note?: string,
  ): Promise<ScenarioSaveResult> {
    const path = buildScenarioPath(taskType, taskSubtype);
    return await apiClient.post<ScenarioSaveResult>(`${path}/save`, { scenario, note });
  },

  async getScenarioVersions(taskType: TaskType, taskSubtype: string): Promise<ScenarioVersionHistoryItem[]> {
    const path = buildScenarioPath(taskType, taskSubtype);
    return await apiClient.get<ScenarioVersionHistoryItem[]>(`${path}/versions`);
  },

  async restoreScenarioVersion(
    taskType: TaskType,
    taskSubtype: string,
    versionNumber: number,
  ): Promise<ScenarioRestoreResult> {
    const path = buildScenarioPath(taskType, taskSubtype);
    return await apiClient.post<ScenarioRestoreResult>(`${path}/restore`, { version_number: versionNumber });
  },

  async simulateScenario(payload: ScenarioSimulatePayload): Promise<ScenarioSimulateResult> {
    return await apiClient.post<ScenarioSimulateResult>('/api/v1/scenarios/simulate', payload);
  },
};


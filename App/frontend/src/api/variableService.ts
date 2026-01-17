/**
 * API service for prompt variable management
 */
import { apiClient } from './client';
import type {
  PromptVariable,
  VariableCreate,
  VariableValueUpdate,
  VariableDefinitionUpdate,
  VariablesForTemplateResponse,
  VariableReorderRequest,
} from '../types/variables';

const BASE_PATH = '/api/v1/variables';

export const variableService = {
  /**
   * Get all variables for the current user
   */
  async getAllVariables(): Promise<PromptVariable[]> {
    return await apiClient.get<PromptVariable[]>(BASE_PATH);
  },

  /**
   * Get all variables as a dict for template engine usage
   */
  async getVariablesForTemplate(): Promise<VariablesForTemplateResponse> {
    return await apiClient.get<VariablesForTemplateResponse>(`${BASE_PATH}/values`);
  },

  /**
   * Get a single variable by ID
   */
  async getVariableById(id: string): Promise<PromptVariable> {
    return await apiClient.get<PromptVariable>(`${BASE_PATH}/by-id/${encodeURIComponent(id)}`);
  },

  /**
   * Create a new variable
   */
  async createVariable(data: VariableCreate): Promise<PromptVariable> {
    return await apiClient.post<PromptVariable>(BASE_PATH, data);
  },

  /**
   * Update variable value by ID (for auto-save)
   */
  async updateVariableValueById(id: string, value: string | number | boolean | null): Promise<PromptVariable> {
    const data: VariableValueUpdate = { value };
    return await apiClient.patch<PromptVariable>(
      `${BASE_PATH}/by-id/${encodeURIComponent(id)}/value`,
      data
    );
  },

  /**
   * Update variable definition by ID (name, description, options)
   */
  async updateVariableDefinitionById(id: string, data: VariableDefinitionUpdate): Promise<PromptVariable> {
    return await apiClient.put<PromptVariable>(
      `${BASE_PATH}/by-id/${encodeURIComponent(id)}`,
      data
    );
  },

  /**
   * Delete a variable by ID
   */
  async deleteVariableById(id: string): Promise<void> {
    await apiClient.delete(`${BASE_PATH}/by-id/${encodeURIComponent(id)}`);
  },

  /**
   * Reorder variables by IDs
   */
  async reorderVariables(orderedIds: string[]): Promise<void> {
    const data: VariableReorderRequest = { ordered_ids: orderedIds };
    await apiClient.put(`${BASE_PATH}/reorder`, data);
  },
};

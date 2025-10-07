/**
 * Project service
 */

import apiClient from './client';
import type { ProjectCreate, ProjectUpdate, ProjectResponse } from './types';

export const projectService = {
  /**
   * Create a new project
   */
  async create(data: ProjectCreate): Promise<ProjectResponse> {
    return apiClient.post<ProjectResponse>('/api/v1/projects', data);
  },

  /**
   * Get all projects for current user
   */
  async list(): Promise<ProjectResponse[]> {
    const response = await apiClient.get<{ projects: ProjectResponse[]; total: number }>('/api/v1/projects');
    return response.projects;
  },

  /**
   * Get a specific project
   */
  async get(projectId: string): Promise<ProjectResponse> {
    return apiClient.get<ProjectResponse>(`/api/v1/projects/${projectId}`);
  },

  /**
   * Update a project
   */
  async update(projectId: string, data: ProjectUpdate): Promise<ProjectResponse> {
    return apiClient.put<ProjectResponse>(`/api/v1/projects/${projectId}`, data);
  },

  /**
   * Delete a project
   */
  async delete(projectId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/projects/${projectId}`);
  },
};

export default projectService;

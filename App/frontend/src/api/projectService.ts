/**
 * Project service
 */

import apiClient, { API_BASE_URL, ApiError } from './client';
import type { ProjectCreate, ProjectUpdate, ProjectResponse } from './types';

export type ProjectExportImageScope = 'used_only' | 'all' | 'manual';

export interface ProjectExportOptions {
  include_images: boolean;
  image_scope: ProjectExportImageScope;
  include_non_main_story_object_images: boolean;
  treat_generation_reference_images_as_used: boolean;
}

export interface ProjectExportPreviewSummary {
  objects: number;
  assets_total: number;
  assets_selected: number;
  images_selected_bytes: number;
}

export interface ProjectExportPreviewAssetItem {
  asset_id: string;
  name: string;
  asset_type?: string | null;
  file_size?: number | null;
  file_url: string;
  thumbnail_url?: string | null;
  used: boolean;
  reasons: string[];
}

export interface ProjectExportPreviewResponse {
  summary: ProjectExportPreviewSummary;
  assets: ProjectExportPreviewAssetItem[];
  default_selected_asset_ids: string[];
}

export interface ProjectExportRequest {
  options: ProjectExportOptions;
  asset_ids?: string[];
}

function parseDownloadFilename(disposition: string | null): string | null {
  if (!disposition) return null;
  // Supports: filename="x.nbproj" and filename*=UTF-8''x.nbproj
  const filenameStar = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (filenameStar?.[1]) {
    try {
      return decodeURIComponent(filenameStar[1]);
    } catch {
      return filenameStar[1];
    }
  }
  const filename = disposition.match(/filename\s*=\s*\"?([^\";]+)\"?/i);
  return filename?.[1] ?? null;
}

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

  async exportPreview(projectId: string, options: ProjectExportOptions): Promise<ProjectExportPreviewResponse> {
    return apiClient.post<ProjectExportPreviewResponse>(`/api/v1/projects/${projectId}/export/preview`, options);
  },

  async exportDownload(projectId: string, request: ProjectExportRequest): Promise<void> {
    const url = `${API_BASE_URL}/api/v1/projects/${projectId}/export`;
    const token = apiClient.getAuthToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      const message = data?.detail || response.statusText || 'Request failed';
      throw new ApiError(message, response.status, data);
    }

    const blob = await response.blob();
    const filename = parseDownloadFilename(response.headers.get('Content-Disposition')) || 'project.nbproj';

    const blobUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  },

  async importProject(file: File): Promise<ProjectResponse> {
    const form = new FormData();
    form.append('file', file);
    return apiClient.postFormData<ProjectResponse>('/api/v1/projects/import', form);
  },
};

export default projectService;

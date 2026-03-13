import { apiClient } from './client';

export interface VectorStorageEmbeddingProfile {
  provider: string;
  model: string;
  dimensions?: number | null;
}

export interface VectorStorageStatusResponse {
  enabled: boolean;
  profile?: VectorStorageEmbeddingProfile | null;
  total_sources: number;
  ready_sources: number;
  stale_sources: number;
  unindexed_sources: number;
  missing_main_language_sources: number;
  error_sources: number;
  last_indexed_at?: string | null;
}

export interface VectorStorageReindexRequest {
  force?: boolean;
}

export interface VectorStorageReindexResponse {
  indexed_sources: number;
  rebuilt_sources: number;
  skipped_sources: number;
  missing_main_language_sources: number;
}

export const vectorStorageService = {
  async getStatus(projectId: string): Promise<VectorStorageStatusResponse> {
    return await apiClient.get<VectorStorageStatusResponse>(`/api/v1/projects/${projectId}/vector-storage/status`);
  },

  async reindex(projectId: string, request: VectorStorageReindexRequest): Promise<VectorStorageReindexResponse> {
    return await apiClient.post<VectorStorageReindexResponse>(`/api/v1/projects/${projectId}/vector-storage/reindex`, request);
  },
};

import { apiClient } from './client';

export interface RagEmbeddingProfile {
  provider: string;
  model: string;
  dimensions?: number | null;
}

export interface RagProjectStatusResponse {
  enabled: boolean;
  profile?: RagEmbeddingProfile | null;
  total_sources: number;
  ready_sources: number;
  stale_sources: number;
  unindexed_sources: number;
  missing_main_language_sources: number;
  error_sources: number;
  last_indexed_at?: string | null;
}

export interface RagReindexRequest {
  force?: boolean;
}

export interface RagReindexResponse {
  indexed_sources: number;
  rebuilt_sources: number;
  skipped_sources: number;
  missing_main_language_sources: number;
}

export const ragService = {
  async getStatus(projectId: string): Promise<RagProjectStatusResponse> {
    return await apiClient.get<RagProjectStatusResponse>(`/api/v1/projects/${projectId}/rag/status`);
  },

  async reindex(projectId: string, request: RagReindexRequest): Promise<RagReindexResponse> {
    return await apiClient.post<RagReindexResponse>(`/api/v1/projects/${projectId}/rag/reindex`, request);
  },
};

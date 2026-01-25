import { apiClient } from './client';

export interface RagEmbeddingProfile {
  provider: string;
  model: string;
  dimensions?: number | null;
}

export interface RagEmbeddingProfileUpdate {
  provider: string;
  model: string;
}

export interface RagProviderConfig {
  api_key?: string;
  base_url?: string;
  additional_headers?: Record<string, string>;
}

export interface RagProjectStatusResponse {
  profile?: RagEmbeddingProfile | null;
  total_sources: number;
  ready_sources: number;
  missing_main_language_sources: number;
  error_sources: number;
  last_indexed_at?: string | null;
}

export interface RagIndexObjectRequest {
  object_type: string;
  object_id: string;
  force?: boolean;
  config?: RagProviderConfig;
}

export interface RagDeleteObjectRequest {
  object_type: string;
  object_id: string;
}

export interface RagReindexRequest {
  force?: boolean;
  config?: RagProviderConfig;
}

export interface RagReindexResponse {
  indexed_sources: number;
  rebuilt_sources: number;
  skipped_sources: number;
  missing_main_language_sources: number;
}

export interface RagSearchRequest {
  queries: string[];
  top_k_per_query?: number;
  neighbor_window?: number;
  config?: RagProviderConfig;
}

export interface RagSearchResult {
  chunk_id: string;
  source_id: string;
  object_type: string;
  object_id: string;
  type_group: string;
  story_object_type?: string | null;
  story_object_order?: number | null;
  outline_order?: number | null;
  act_order?: number | null;
  chapter_order?: number | null;
  chapter_id?: string | null;
  field_path: string;
  chunk_index: number;
  text: string;
  distance?: number | null;
}

export interface RagSearchResponse {
  results: RagSearchResult[];
}

export const ragService = {
  async getProfile(): Promise<RagEmbeddingProfile | null> {
    return await apiClient.get<RagEmbeddingProfile | null>('/api/v1/rag/profile');
  },

  async updateProfile(update: RagEmbeddingProfileUpdate): Promise<RagEmbeddingProfile> {
    return await apiClient.put<RagEmbeddingProfile>('/api/v1/rag/profile', update);
  },

  async getStatus(projectId: string): Promise<RagProjectStatusResponse> {
    return await apiClient.get<RagProjectStatusResponse>(`/api/v1/projects/${projectId}/rag/status`);
  },

  async indexObject(projectId: string, request: RagIndexObjectRequest): Promise<any> {
    return await apiClient.post(`/api/v1/projects/${projectId}/rag/index-object`, request);
  },

  async deleteObject(projectId: string, request: RagDeleteObjectRequest): Promise<any> {
    return await apiClient.post(`/api/v1/projects/${projectId}/rag/delete-object`, request);
  },

  async reindex(projectId: string, request: RagReindexRequest): Promise<RagReindexResponse> {
    return await apiClient.post<RagReindexResponse>(`/api/v1/projects/${projectId}/rag/reindex`, request);
  },

  async search(projectId: string, request: RagSearchRequest): Promise<RagSearchResponse> {
    return await apiClient.post<RagSearchResponse>(`/api/v1/projects/${projectId}/rag/search`, request);
  },
};


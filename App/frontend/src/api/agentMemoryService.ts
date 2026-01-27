import { apiClient } from './client';

export type AgentMemoryStatusResponse = {
  hasMemory: boolean;
  summaryCount: number;
  lastSummaryText?: string | null;
  archivedUntilMessageId?: string | null;
  indexedMessageCount: number;
};

export type AgentMemoryArchiveRequest = {
  language: string;
  archive_until_message_id: string;
  summary_messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  summary_config?: {
    api_key?: string;
    base_url?: string;
    additional_headers?: Record<string, string>;
  };
  embedding_config?: {
    api_key?: string;
    base_url?: string;
    additional_headers?: Record<string, string>;
  };
};

export type AgentMemoryArchiveResponse = {
  archived_until_message_id?: string | null;
  summary_id?: string | null;
  summary_text?: string | null;
  archived_message_ids: string[];
  indexed_count: number;
};

export type AgentMemorySearchRequest = {
  language: string;
  queries: string[];
  top_k_per_query?: number;
  config?: {
    api_key?: string;
    base_url?: string;
    additional_headers?: Record<string, string>;
  };
};

export type AgentMemorySearchResult = {
  message_id: string;
  role: string;
  content: string;
  created_at: string;
  distance?: number | null;
};

export type AgentMemorySearchResponse = {
  results: AgentMemorySearchResult[];
};

export const agentMemoryService = {
  async status(projectId: string, agentId: string): Promise<AgentMemoryStatusResponse> {
    return await apiClient.get<AgentMemoryStatusResponse>(
      `/api/v1/projects/${projectId}/agents/${agentId}/memory/status`
    );
  },

  async archive(projectId: string, agentId: string, req: AgentMemoryArchiveRequest): Promise<AgentMemoryArchiveResponse> {
    return await apiClient.post<AgentMemoryArchiveResponse>(
      `/api/v1/projects/${projectId}/agents/${agentId}/memory/archive`,
      req
    );
  },

  async search(projectId: string, agentId: string, req: AgentMemorySearchRequest): Promise<AgentMemorySearchResponse> {
    return await apiClient.post<AgentMemorySearchResponse>(
      `/api/v1/projects/${projectId}/agents/${agentId}/memory/search`,
      req
    );
  },
};

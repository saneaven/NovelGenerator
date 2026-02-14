import { apiClient, type RequestOptions } from './client';

export type MemoryStatusResponse = {
  hasMemory: boolean;
  summaryCount: number;
  lastSummaryText?: string | null;
  archivedUntilMessageId?: string | null;
  indexedMessageCount: number;
};

export type MemoryArchiveRequest = {
  language: string;
  archive_until_message_id: string;
  summary_text: string;
  archived_messages: Array<{
    message_id: string;
    role: string;
    content: string;
    created_at?: string;
    tool_calls?: unknown[];
  }>;
  embedding_config?: {
    api_key?: string;
    base_url?: string;
    additional_headers?: Record<string, string>;
  };
};

export type MemoryArchiveResponse = {
  archived_until_message_id?: string | null;
  summary_id?: string | null;
  summary_text?: string | null;
  archived_message_ids: string[];
  indexed_count: number;
};

export type MemorySearchRequest = {
  language: string;
  queries: string[];
  top_k_per_query?: number;
  config?: {
    api_key?: string;
    base_url?: string;
    additional_headers?: Record<string, string>;
  };
};

export type MemorySearchResult = {
  message_id: string;
  role: string;
  content: string;
  created_at: string;
  distance?: number | null;
  field_path?: string | null;
  chunk_index?: number | null;
};

export type MemorySearchResponse = {
  results: MemorySearchResult[];
};

function buildUrl(base: string, ownerId?: string): string {
  if (!ownerId) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}owner_id=${encodeURIComponent(ownerId)}`;
}

export const memoryService = {
  async status(projectId: string, agentId: string, options?: RequestOptions & { ownerId?: string }): Promise<MemoryStatusResponse> {
    const url = buildUrl(`/api/v1/projects/${projectId}/agents/${agentId}/memory/status`, options?.ownerId);
    return await apiClient.get<MemoryStatusResponse>(url, undefined, options);
  },

  async archive(
    projectId: string,
    agentId: string,
    req: MemoryArchiveRequest,
    options?: RequestOptions & { ownerId?: string }
  ): Promise<MemoryArchiveResponse> {
    const url = buildUrl(`/api/v1/projects/${projectId}/agents/${agentId}/memory/archive`, options?.ownerId);
    return await apiClient.post<MemoryArchiveResponse>(url, req, undefined, options);
  },

  async search(
    projectId: string,
    agentId: string,
    req: MemorySearchRequest,
    options?: RequestOptions & { ownerId?: string }
  ): Promise<MemorySearchResponse> {
    const url = buildUrl(`/api/v1/projects/${projectId}/agents/${agentId}/memory/search`, options?.ownerId);
    return await apiClient.post<MemorySearchResponse>(url, req, undefined, options);
  },
};

/**
 * Unified run runtime API service.
 */

import apiClient from './client';
import type {
  AddRunMessageRequest,
  AddRunMessageResponse,
  CreateUnifiedRunRequest,
  CreateUnifiedRunResponse,
  GetUnifiedRunResponse,
  PatchRunMessageRequest,
  PatchRunMessageResponse,
  PatchUnifiedRunRequest,
  PatchUnifiedRunResponse,
  QueryRunsRequest,
  QueryRunsResponse,
  UpsertRunToolCallsRequest,
  UpsertRunToolCallsResponse,
} from './types';


function basePath(projectId: string, agentId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/runs`;
}


export const runService = {
  async createRun(
    projectId: string,
    agentId: string,
    data: CreateUnifiedRunRequest
  ): Promise<CreateUnifiedRunResponse> {
    return apiClient.post<CreateUnifiedRunResponse>(basePath(projectId, agentId), data);
  },

  async patchRun(
    projectId: string,
    agentId: string,
    runId: string,
    data: PatchUnifiedRunRequest
  ): Promise<PatchUnifiedRunResponse> {
    return apiClient.patch<PatchUnifiedRunResponse>(
      `${basePath(projectId, agentId)}/${encodeURIComponent(runId)}`,
      data
    );
  },

  async getRun(
    projectId: string,
    agentId: string,
    runId: string,
    opts?: { includeMessages?: boolean; includeToolCalls?: boolean }
  ): Promise<GetUnifiedRunResponse> {
    const params = new URLSearchParams();
    params.set('include_messages', String(opts?.includeMessages ?? true));
    params.set('include_tool_calls', String(opts?.includeToolCalls ?? true));
    return apiClient.get<GetUnifiedRunResponse>(
      `${basePath(projectId, agentId)}/${encodeURIComponent(runId)}?${params.toString()}`
    );
  },

  async queryRuns(
    projectId: string,
    agentId: string,
    data: QueryRunsRequest
  ): Promise<QueryRunsResponse> {
    return apiClient.post<QueryRunsResponse>(`${basePath(projectId, agentId)}/query`, data);
  },

  async addRunMessage(
    projectId: string,
    agentId: string,
    runId: string,
    data: AddRunMessageRequest
  ): Promise<AddRunMessageResponse> {
    return apiClient.post<AddRunMessageResponse>(
      `${basePath(projectId, agentId)}/${encodeURIComponent(runId)}/messages`,
      data
    );
  },

  async patchRunMessage(
    projectId: string,
    agentId: string,
    runId: string,
    runMessageId: string,
    data: PatchRunMessageRequest
  ): Promise<PatchRunMessageResponse> {
    return apiClient.patch<PatchRunMessageResponse>(
      `${basePath(projectId, agentId)}/${encodeURIComponent(runId)}/messages/${encodeURIComponent(runMessageId)}`,
      data
    );
  },

  async upsertRunToolCalls(
    projectId: string,
    agentId: string,
    runId: string,
    runMessageId: string,
    data: UpsertRunToolCallsRequest
  ): Promise<UpsertRunToolCallsResponse> {
    return apiClient.put<UpsertRunToolCallsResponse>(
      `${basePath(projectId, agentId)}/${encodeURIComponent(runId)}/messages/${encodeURIComponent(runMessageId)}/tool-calls`,
      data
    );
  },
};


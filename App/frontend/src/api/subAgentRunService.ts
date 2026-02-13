/**
 * API service for persistent Sub Agent runs — incremental persistence.
 */
import apiClient from './client';
import type {
  AddMessageRequest,
  AddMessageResponse,
  CreateRunRequest,
  CreateRunResponse,
  PatchRunRequest,
  PatchRunResponse,
  SubAgentRunQueryByMessagesRequest,
  SubAgentRunQueryByMessagesResponse,
  UpdateMessageRequest,
  UpdateMessageResponse,
} from './types';


function basePath(projectId: string, agentId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sub-agent-runs`;
}


export const subAgentRunService = {
  async createRun(
    projectId: string,
    agentId: string,
    data: CreateRunRequest,
  ): Promise<CreateRunResponse> {
    return apiClient.post<CreateRunResponse>(basePath(projectId, agentId), data);
  },

  async patchRun(
    projectId: string,
    agentId: string,
    runId: string,
    data: PatchRunRequest,
  ): Promise<PatchRunResponse> {
    return apiClient.patch<PatchRunResponse>(`${basePath(projectId, agentId)}/${encodeURIComponent(runId)}`, data);
  },

  async addMessage(
    projectId: string,
    agentId: string,
    runId: string,
    data: AddMessageRequest,
  ): Promise<AddMessageResponse> {
    return apiClient.post<AddMessageResponse>(`${basePath(projectId, agentId)}/${encodeURIComponent(runId)}/messages`, data);
  },

  async updateMessage(
    projectId: string,
    agentId: string,
    runId: string,
    messageId: string,
    data: UpdateMessageRequest,
  ): Promise<UpdateMessageResponse> {
    return apiClient.put<UpdateMessageResponse>(
      `${basePath(projectId, agentId)}/${encodeURIComponent(runId)}/messages/${encodeURIComponent(messageId)}`,
      data,
    );
  },

  async queryByMessages(
    projectId: string,
    agentId: string,
    data: SubAgentRunQueryByMessagesRequest,
  ): Promise<SubAgentRunQueryByMessagesResponse> {
    return apiClient.post<SubAgentRunQueryByMessagesResponse>(`${basePath(projectId, agentId)}/query-by-messages`, data);
  },
};

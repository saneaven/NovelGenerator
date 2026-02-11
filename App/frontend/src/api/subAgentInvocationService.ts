/**
 * API service for persistent Sub Agent invocation states.
 */
import apiClient from './client';
import type {
  SubAgentInvocationQueryByMessagesRequest,
  SubAgentInvocationQueryByMessagesResponse,
  SubAgentInvocationStateRequest,
  SubAgentInvocationStateResponse,
} from './types';


function basePath(projectId: string, agentId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sub-agent-invocations`;
}


export const subAgentInvocationService = {
  async upsertState(
    projectId: string,
    agentId: string,
    data: SubAgentInvocationStateRequest
  ): Promise<SubAgentInvocationStateResponse> {
    return apiClient.post<SubAgentInvocationStateResponse>(`${basePath(projectId, agentId)}/states`, data);
  },

  async queryByMessages(
    projectId: string,
    agentId: string,
    data: SubAgentInvocationQueryByMessagesRequest
  ): Promise<SubAgentInvocationQueryByMessagesResponse> {
    return apiClient.post<SubAgentInvocationQueryByMessagesResponse>(`${basePath(projectId, agentId)}/query-by-messages`, data);
  },
};

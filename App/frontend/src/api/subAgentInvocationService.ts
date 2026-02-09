/**
 * API service for persistent Sub Agent invocation snapshots.
 */
import apiClient from './client';
import type {
  SubAgentInvocationQueryByMessagesRequest,
  SubAgentInvocationQueryByMessagesResponse,
  SubAgentInvocationSnapshotRequest,
  SubAgentInvocationSnapshotResponse,
} from './types';


function basePath(projectId: string, agentId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/sub-agent-invocations`;
}


export const subAgentInvocationService = {
  async upsertSnapshot(
    projectId: string,
    agentId: string,
    data: SubAgentInvocationSnapshotRequest
  ): Promise<SubAgentInvocationSnapshotResponse> {
    return apiClient.post<SubAgentInvocationSnapshotResponse>(`${basePath(projectId, agentId)}/snapshots`, data);
  },

  async queryByMessages(
    projectId: string,
    agentId: string,
    data: SubAgentInvocationQueryByMessagesRequest
  ): Promise<SubAgentInvocationQueryByMessagesResponse> {
    return apiClient.post<SubAgentInvocationQueryByMessagesResponse>(`${basePath(projectId, agentId)}/query-by-messages`, data);
  },
};


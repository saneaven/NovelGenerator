/**
 * Unified run runtime API service.
 */

import apiClient from './client';
import type {
  PatchRunMessageRequest,
  PatchRunMessageResponse,
  TranslateRunMessageRequest,
  TranslateRunMessageResponse,
} from './types';


function basePath(projectId: string, agentId: string): string {
  void agentId;
  return `/api/v1/projects/${encodeURIComponent(projectId)}/runs`;
}


export const runService = {
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

  async translateRunMessage(
    projectId: string,
    agentId: string,
    runId: string,
    runMessageId: string,
    data: TranslateRunMessageRequest
  ): Promise<TranslateRunMessageResponse> {
    return apiClient.put<TranslateRunMessageResponse>(
      `${basePath(projectId, agentId)}/${encodeURIComponent(runId)}/messages/${encodeURIComponent(runMessageId)}/translate`,
      data
    );
  },

  async deleteRunMessage(
    projectId: string,
    agentId: string,
    runId: string,
    runMessageId: string
  ): Promise<void> {
    return apiClient.delete<void>(
      `${basePath(projectId, agentId)}/${encodeURIComponent(runId)}/messages/${encodeURIComponent(runMessageId)}`
    );
  },
};


/**
 * Timeline API service for unified run history.
 */

import apiClient from './client';
import type { TimelineResponse } from './types';


function basePath(projectId: string, agentId: string): string {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}/timeline`;
}


export const timelineService = {
  async getTimeline(
    projectId: string,
    agentId: string,
    opts?: {
      includeChildren?: boolean;
      limit?: number;
      cursor?: string;
    }
  ): Promise<TimelineResponse> {
    const params = new URLSearchParams();
    params.set('include_children', String(opts?.includeChildren ?? true));
    params.set('limit', String(opts?.limit ?? 50));
    if (opts?.cursor) {
      params.set('cursor', opts.cursor);
    }
    return apiClient.get<TimelineResponse>(`${basePath(projectId, agentId)}?${params.toString()}`);
  },
};

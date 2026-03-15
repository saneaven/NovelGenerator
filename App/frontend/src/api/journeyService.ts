import { apiClient } from './client';
import type { McpSelection } from '../types/mcp';
import type { ThreadStatus } from '../types/thread';

export type JourneyKind =
  | 'manuscriptEdit'
  | 'outlineEdit'
  | 'storyObjectEdit'
  | 'objectTranslation'
  | 'imagePrompt'
  | 'sceneImagePrompt'
  | 'messageTranslation';

export interface CreateJourneyRequest {
  kind: JourneyKind;
  display_label?: string;
  input_text: string;
  input_payload?: Record<string, unknown>;
  run_mode?: 'planMode' | 'agentMode';
  surface?: string;
  context_object_ids?: string[];
  journey_target_ids?: string[];
  language?: string;
  mcp_selections?: McpSelection[];
}

export interface CreateJourneyResponse {
  journey_id: string;
  thread_id: string;
  run_id: string;
  status: ThreadStatus;
}

export interface JourneyDTO {
  journey_id: string;
  project_id: string;
  thread_id: string;
  latest_run_id: string | null;
  latest_message_at: string | null;
  kind: JourneyKind;
  display_label: string;
  status: ThreadStatus;
  last_error: string | null;
  updated_at: string;
}

export interface JourneyListResponseDTO {
  items: JourneyDTO[];
}

export interface DeleteAllJourneysResponseDTO {
  deleted: number;
}

export const journeyService = {
  async create(projectId: string, payload: CreateJourneyRequest): Promise<CreateJourneyResponse> {
    return apiClient.post<CreateJourneyResponse>(`/api/v1/projects/${projectId}/journeys`, payload);
  },

  async list(projectId: string): Promise<JourneyDTO[]> {
    const raw = await apiClient.get<JourneyListResponseDTO>(`/api/v1/projects/${projectId}/journeys`);
    return raw.items;
  },

  async get(journeyId: string): Promise<JourneyDTO> {
    return apiClient.get<JourneyDTO>(`/api/v1/journeys/${journeyId}`);
  },

  async cancel(journeyId: string): Promise<void> {
    await apiClient.post(`/api/v1/journeys/${journeyId}/cancel`);
  },

  async resume(journeyId: string): Promise<{ thread_id: string; run_id: string; status: ThreadStatus; thread_status: ThreadStatus }> {
    return apiClient.post(`/api/v1/journeys/${journeyId}/resume`);
  },

  async delete(projectId: string, journeyId: string): Promise<void> {
    await apiClient.delete<void>(`/api/v1/projects/${projectId}/journeys/${journeyId}`);
  },

  async deleteAll(projectId: string): Promise<DeleteAllJourneysResponseDTO> {
    return apiClient.post<DeleteAllJourneysResponseDTO>(`/api/v1/projects/${projectId}/journeys/delete-all`);
  },
};

export default journeyService;

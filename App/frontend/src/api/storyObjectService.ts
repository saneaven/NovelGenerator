/**
 * Story Object service (BasicInfo, Characters, Organizations, Locations, Lorebook, Outline, Acts, Chapters)
 */

import apiClient from './client';
import type {
  BasicInfoCreate,
  BasicInfoUpdate,
  BasicInfoResponse,
  NameDescriptionCreate,
  NameDescriptionUpdate,
  NameDescriptionResponse,
  OutlineResponse,
  ActCreate,
  ActUpdate,
  ActResponse,
  ChapterCreate,
  ChapterUpdate,
  ChapterResponse,
} from './types';

export const storyObjectService = {
  // ============================================================================
  // BASIC INFO
  // ============================================================================

  basicInfo: {
    async create(projectId: string, data: BasicInfoCreate): Promise<BasicInfoResponse> {
      return apiClient.post<BasicInfoResponse>(
        `/api/v1/projects/${projectId}/basic-info`,
        data
      );
    },

    async get(projectId: string): Promise<BasicInfoResponse> {
      return apiClient.get<BasicInfoResponse>(`/api/v1/projects/${projectId}/basic-info`);
    },

    async update(projectId: string, data: BasicInfoUpdate): Promise<BasicInfoResponse> {
      return apiClient.put<BasicInfoResponse>(
        `/api/v1/projects/${projectId}/basic-info`,
        data
      );
    },
  },

  // ============================================================================
  // CHARACTERS
  // ============================================================================

  characters: {
    async create(
      projectId: string,
      data: NameDescriptionCreate
    ): Promise<NameDescriptionResponse> {
      return apiClient.post<NameDescriptionResponse>(
        `/api/v1/projects/${projectId}/characters`,
        data
      );
    },

    async list(projectId: string): Promise<NameDescriptionResponse[]> {
      return apiClient.get<NameDescriptionResponse[]>(
        `/api/v1/projects/${projectId}/characters`
      );
    },

    async get(projectId: string, characterId: string): Promise<NameDescriptionResponse> {
      return apiClient.get<NameDescriptionResponse>(
        `/api/v1/projects/${projectId}/characters/${characterId}`
      );
    },

    async update(
      projectId: string,
      characterId: string,
      data: NameDescriptionUpdate
    ): Promise<NameDescriptionResponse> {
      return apiClient.put<NameDescriptionResponse>(
        `/api/v1/projects/${projectId}/characters/${characterId}`,
        data
      );
    },

    async delete(projectId: string, characterId: string): Promise<void> {
      return apiClient.delete<void>(
        `/api/v1/projects/${projectId}/characters/${characterId}`
      );
    },
  },

  // ============================================================================
  // ORGANIZATIONS
  // ============================================================================

  organizations: {
    async create(
      projectId: string,
      data: NameDescriptionCreate
    ): Promise<NameDescriptionResponse> {
      return apiClient.post<NameDescriptionResponse>(
        `/api/v1/projects/${projectId}/organizations`,
        data
      );
    },

    async list(projectId: string): Promise<NameDescriptionResponse[]> {
      return apiClient.get<NameDescriptionResponse[]>(
        `/api/v1/projects/${projectId}/organizations`
      );
    },
  },

  // ============================================================================
  // LOCATIONS
  // ============================================================================

  locations: {
    async create(
      projectId: string,
      data: NameDescriptionCreate
    ): Promise<NameDescriptionResponse> {
      return apiClient.post<NameDescriptionResponse>(
        `/api/v1/projects/${projectId}/locations`,
        data
      );
    },

    async list(projectId: string): Promise<NameDescriptionResponse[]> {
      return apiClient.get<NameDescriptionResponse[]>(
        `/api/v1/projects/${projectId}/locations`
      );
    },
  },

  // ============================================================================
  // LOREBOOK
  // ============================================================================

  lorebook: {
    async create(
      projectId: string,
      data: NameDescriptionCreate
    ): Promise<NameDescriptionResponse> {
      return apiClient.post<NameDescriptionResponse>(
        `/api/v1/projects/${projectId}/lorebook`,
        data
      );
    },

    async list(projectId: string): Promise<NameDescriptionResponse[]> {
      return apiClient.get<NameDescriptionResponse[]>(`/api/v1/projects/${projectId}/lorebook`);
    },
  },

  // ============================================================================
  // OUTLINE
  // ============================================================================

  outline: {
    async create(projectId: string): Promise<OutlineResponse> {
      return apiClient.post<OutlineResponse>(`/api/v1/projects/${projectId}/outline`);
    },

    async get(projectId: string): Promise<OutlineResponse> {
      return apiClient.get<OutlineResponse>(`/api/v1/projects/${projectId}/outline`);
    },
  },

  // ============================================================================
  // ACTS
  // ============================================================================

  acts: {
    async create(projectId: string, data: ActCreate): Promise<ActResponse> {
      return apiClient.post<ActResponse>(`/api/v1/projects/${projectId}/outline/acts`, data);
    },

    async list(projectId: string): Promise<ActResponse[]> {
      return apiClient.get<ActResponse[]>(`/api/v1/projects/${projectId}/outline/acts`);
    },

    async update(projectId: string, actId: string, data: ActUpdate): Promise<ActResponse> {
      return apiClient.put<ActResponse>(
        `/api/v1/projects/${projectId}/outline/acts/${actId}`,
        data
      );
    },

    async delete(projectId: string, actId: string): Promise<void> {
      return apiClient.delete<void>(`/api/v1/projects/${projectId}/outline/acts/${actId}`);
    },
  },

  // ============================================================================
  // CHAPTERS
  // ============================================================================

  chapters: {
    async create(
      projectId: string,
      actId: string,
      data: ChapterCreate
    ): Promise<ChapterResponse> {
      return apiClient.post<ChapterResponse>(
        `/api/v1/projects/${projectId}/outline/acts/${actId}/chapters`,
        data
      );
    },

    async list(projectId: string, actId: string): Promise<ChapterResponse[]> {
      return apiClient.get<ChapterResponse[]>(
        `/api/v1/projects/${projectId}/outline/acts/${actId}/chapters`
      );
    },

    async update(
      projectId: string,
      chapterId: string,
      data: ChapterUpdate
    ): Promise<ChapterResponse> {
      return apiClient.put<ChapterResponse>(
        `/api/v1/projects/${projectId}/outline/chapters/${chapterId}`,
        data
      );
    },

    async delete(projectId: string, chapterId: string): Promise<void> {
      return apiClient.delete<void>(
        `/api/v1/projects/${projectId}/outline/chapters/${chapterId}`
      );
    },
  },
};

export default storyObjectService;

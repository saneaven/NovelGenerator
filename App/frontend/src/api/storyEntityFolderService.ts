import { apiClient } from './client';
import type {
  StoryEntityFolder,
  StoryEntityFolderDeleteResponse,
  StoryEntityFolderListResponse,
  StoryEntityTreeMoveRequest,
} from '../types/storyEntityFolder';

export const storyEntityFolderService = {
  async list(projectId: string, language?: string): Promise<StoryEntityFolder[]> {
    const response = await apiClient.get<StoryEntityFolderListResponse>(
      `/api/v1/projects/${projectId}/story-entity-folders${language ? `?language=${encodeURIComponent(language)}` : ''}`,
    );
    return response.folders;
  },

  async create(
    projectId: string,
    payload: { language: string; name: string; description?: string; parent_id?: string | null },
  ): Promise<StoryEntityFolder> {
    return apiClient.post<StoryEntityFolder>(
      `/api/v1/projects/${projectId}/story-entity-folders`,
      payload,
    );
  },

  async update(
    projectId: string,
    folderId: string,
    payload: { language: string; name?: string; description?: string; create_new_version?: boolean },
  ): Promise<StoryEntityFolder> {
    return apiClient.patch<StoryEntityFolder>(
      `/api/v1/projects/${projectId}/story-entity-folders/${folderId}`,
      payload,
    );
  },

  async move(projectId: string, folderId: string, payload: { new_parent_id?: string | null; new_index?: number }): Promise<StoryEntityFolder> {
    return apiClient.post<StoryEntityFolder>(
      `/api/v1/projects/${projectId}/story-entity-folders/${folderId}/move`,
      payload,
    );
  },

  async delete(projectId: string, folderId: string): Promise<StoryEntityFolderDeleteResponse> {
    return apiClient.delete<StoryEntityFolderDeleteResponse>(
      `/api/v1/projects/${projectId}/story-entity-folders/${folderId}`,
    );
  },

  async moveTreeNode(projectId: string, payload: StoryEntityTreeMoveRequest): Promise<{ success: boolean; node_kind: 'folder' | 'entity'; node_id: string }> {
    return apiClient.post<{ success: boolean; node_kind: 'folder' | 'entity'; node_id: string }>(
      `/api/v1/projects/${projectId}/story-entities/tree/move`,
      payload,
    );
  },
};

export default storyEntityFolderService;

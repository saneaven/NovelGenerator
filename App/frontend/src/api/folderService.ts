/**
 * API service for prompt folder management
 */
import { apiClient } from './client';
import type { FolderResponse } from '../types/fragments';

const BASE_PATH = '/api/v1/folders';

export const folderService = {
  async createFolder(name: string, parentId: string | null): Promise<FolderResponse> {
    return await apiClient.post<FolderResponse>(BASE_PATH, {
      name,
      parent_id: parentId,
    });
  },

  async renameFolder(folderId: string, name: string): Promise<FolderResponse> {
    return await apiClient.patch<FolderResponse>(`${BASE_PATH}/${folderId}`, {
      name,
    });
  },

  async moveFolder(folderId: string, newParentId: string | null): Promise<FolderResponse> {
    return await apiClient.post<FolderResponse>(`${BASE_PATH}/${folderId}/move`, {
      new_parent_id: newParentId,
    });
  },

  async deleteFolder(folderId: string): Promise<void> {
    await apiClient.delete(`${BASE_PATH}/${folderId}`);
  },
};

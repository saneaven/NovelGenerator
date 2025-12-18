/**
 * API service for prompt fragment management
 */
import { apiClient } from './client';
import type {
  FragmentContent,
  FragmentVersion,
  FragmentVersionHistoryItem,
  FragmentListItem,
  FragmentWithContent,
  FragmentTreeResponse,
  FragmentValidationResponse,
} from '../types/fragments';

const BASE_PATH = '/api/v1/fragments';

export const fragmentService = {
  /**
   * Get all active fragments (without content, for listings)
   */
  async getAllFragments(): Promise<FragmentListItem[]> {
    return await apiClient.get<FragmentListItem[]>(BASE_PATH);
  },

  /**
   * Get all active fragments with content (for template engine)
   */
  async getAllFragmentsWithContent(): Promise<FragmentWithContent[]> {
    return await apiClient.get<FragmentWithContent[]>(`${BASE_PATH}/all`);
  },

  /**
   * Get folder tree structure with all fragments
   */
  async getFolderTree(): Promise<FragmentTreeResponse> {
    return await apiClient.get<FragmentTreeResponse>(`${BASE_PATH}/tree`);
  },

  /**
   * Get active fragment content
   */
  async getFragment(
    folderPath: string | null,
    fragmentName: string
  ): Promise<FragmentContent> {
    const params = new URLSearchParams();
    if (folderPath !== null) {
      params.append('folder_path', folderPath);
    }
    params.append('fragment_name', fragmentName);
    return await apiClient.get<FragmentContent>(`${BASE_PATH}/content?${params.toString()}`);
  },

  /**
   * Create a new fragment
   */
  async createFragment(
    folderPath: string | null,
    fragmentName: string,
    content: string,
    description?: string,
    note?: string
  ): Promise<FragmentVersion> {
    return await apiClient.post<FragmentVersion>(BASE_PATH, {
      folder_path: folderPath,
      fragment_name: fragmentName,
      content,
      description,
      note,
    });
  },

  /**
   * Save new version of a fragment
   */
  async saveFragment(
    folderPath: string | null,
    fragmentName: string,
    content: string,
    description?: string,
    note?: string
  ): Promise<FragmentVersion> {
    const params = new URLSearchParams();
    if (folderPath !== null) {
      params.append('folder_path', folderPath);
    }
    params.append('fragment_name', fragmentName);
    return await apiClient.post<FragmentVersion>(`${BASE_PATH}/save?${params.toString()}`, {
      content,
      description,
      note,
    });
  },

  /**
   * Get version history for a fragment
   */
  async getVersionHistory(
    folderPath: string | null,
    fragmentName: string
  ): Promise<FragmentVersionHistoryItem[]> {
    const params = new URLSearchParams();
    if (folderPath !== null) {
      params.append('folder_path', folderPath);
    }
    params.append('fragment_name', fragmentName);
    return await apiClient.get<FragmentVersionHistoryItem[]>(`${BASE_PATH}/versions?${params.toString()}`);
  },

  /**
   * Restore a specific version
   */
  async restoreVersion(
    folderPath: string | null,
    fragmentName: string,
    versionNumber: number
  ): Promise<void> {
    const params = new URLSearchParams();
    if (folderPath !== null) {
      params.append('folder_path', folderPath);
    }
    params.append('fragment_name', fragmentName);
    await apiClient.post(`${BASE_PATH}/restore?${params.toString()}`, {
      version_number: versionNumber,
    });
  },

  /**
   * Delete a fragment (all versions)
   */
  async deleteFragment(
    folderPath: string | null,
    fragmentName: string
  ): Promise<void> {
    const params = new URLSearchParams();
    if (folderPath !== null) {
      params.append('folder_path', folderPath);
    }
    params.append('fragment_name', fragmentName);
    await apiClient.delete(`${BASE_PATH}?${params.toString()}`);
  },

  /**
   * Move fragment to a different folder
   */
  async moveFragment(
    folderPath: string | null,
    fragmentName: string,
    newFolderPath: string | null
  ): Promise<void> {
    const params = new URLSearchParams();
    if (folderPath !== null) {
      params.append('folder_path', folderPath);
    }
    params.append('fragment_name', fragmentName);
    await apiClient.post(`${BASE_PATH}/move?${params.toString()}`, {
      new_folder_path: newFolderPath,
    });
  },

  /**
   * Validate fragment content
   */
  async validateFragment(content: string): Promise<FragmentValidationResponse> {
    return await apiClient.post<FragmentValidationResponse>(`${BASE_PATH}/validate`, {
      content,
    });
  },
};

/**
 * Novel/Chapter Content service
 */

import apiClient from './client';
import type {
  ChapterContentCreate,
  ChapterContentUpdate,
  ChapterContentResponse,
} from './types';

export const novelService = {
  /**
   * Create chapter content
   */
  async createChapterContent(
    projectId: string,
    chapterId: string,
    data: ChapterContentCreate
  ): Promise<ChapterContentResponse> {
    return apiClient.post<ChapterContentResponse>(
      `/api/v1/projects/${projectId}/chapters/${chapterId}/content`,
      data
    );
  },

  /**
   * Get chapter content with all versions
   */
  async getChapterContent(
    projectId: string,
    chapterId: string
  ): Promise<ChapterContentResponse> {
    return apiClient.get<ChapterContentResponse>(
      `/api/v1/projects/${projectId}/chapters/${chapterId}/content`
    );
  },

  /**
   * Update chapter content (creates new version)
   */
  async updateChapterContent(
    projectId: string,
    chapterId: string,
    data: ChapterContentUpdate
  ): Promise<ChapterContentResponse> {
    return apiClient.put<ChapterContentResponse>(
      `/api/v1/projects/${projectId}/chapters/${chapterId}/content`,
      data
    );
  },

  /**
   * Set active version for chapter content
   */
  async setActiveChapterVersion(
    projectId: string,
    chapterId: string,
    versionId: string
  ): Promise<ChapterContentResponse> {
    return apiClient.patch<ChapterContentResponse>(
      `/api/v1/projects/${projectId}/chapters/${chapterId}/content/versions/${versionId}/activate`,
      {}
    );
  },
};

export default novelService;

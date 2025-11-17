/**
 * Novel/Chapter Content service
 * Now using unified object system
 */

import { unifiedObjectService } from './unifiedObjectService';
import type {
  ChapterContentCreate,
  ChapterContentUpdate,
  ChapterContentResponse,
  ChapterContentVersionResponse,
} from './types';
import type {
  UnifiedObject,
  ChapterContentData,
  VersionHistoryEntry,
} from '../types/unifiedObject';

// ============================================================================
// HELPER: Find chapter content ID from chapter ID
// ============================================================================

/**
 * Find the chapter_content object ID for a given chapter ID
 * Returns null if not found
 */
async function findChapterContentId(
  projectId: string,
  chapterId: string
): Promise<string | null> {
  try {
    const result = await unifiedObjectService.listObjects<ChapterContentData>(
      'chapter_content',
      projectId,
      { page_size: 100 } // backend limit is 100 per request
    );

    const contentObj = result.objects.find(
      (obj) => obj.metadata.chapter_id === chapterId
    );

    return contentObj?.id || null;
  } catch (error) {
    console.error('[novelService] Error finding chapter content ID:', error);
    return null;
  }
}

// ============================================================================
// CONVERSION: Unified Object → Old Response Format
// ============================================================================

/**
 * Convert UnifiedObject to old ChapterContentResponse format
 * This maintains backward compatibility with existing code
 */
function convertToLegacyFormat(
  unifiedObj: UnifiedObject<ChapterContentData>,
  versionHistory?: VersionHistoryEntry[]
): ChapterContentResponse {
  // Convert version history to old format
  const versions: ChapterContentVersionResponse[] = [];

  if (versionHistory && versionHistory.length > 0) {
    versionHistory.forEach((version) => {
      const languageData: Record<string, { content: string; wordCount: number }> = {};

      // Convert version.data from {language: {content, wordCount}} format
      Object.entries(version.data).forEach(([lang, data]: [string, any]) => {
        if (data && typeof data === 'object') {
          languageData[lang] = {
            content: data.content || '',
            wordCount: data.wordCount || 0,
          };
        }
      });

      versions.push({
        id: version.id,
        chapter_content_id: unifiedObj.id,
        userRequest: version.user_request || 'No description',
        is_active: version.id === unifiedObj.version.id,
        data: languageData,
        timestamp: version.created_at,
      });
    });
  } else {
    // If no version history provided, create single version from current data
    const currentData: Record<string, { content: string; wordCount: number }> = {};

    // Add current language data
    unifiedObj.languages.available.forEach((lang) => {
      if (lang === unifiedObj.languages.active) {
        currentData[lang] = {
          content: unifiedObj.data.content || '',
          wordCount: unifiedObj.data.wordCount || 0,
        };
      }
    });

    versions.push({
      id: unifiedObj.version.id,
      chapter_content_id: unifiedObj.id,
      userRequest: 'Current version',
      is_active: true,
      data: currentData,
      timestamp: unifiedObj.version.created_at,
    });
  }

  return {
    id: unifiedObj.id,
    chapter_id: unifiedObj.metadata.chapter_id!,
    active_version_id: unifiedObj.version.id,
    created_at: unifiedObj.metadata.created_at,
    updated_at: unifiedObj.metadata.updated_at,
    versions,
  };
}

// ============================================================================
// PUBLIC API
// ============================================================================

export const novelService = {
  /**
   * Create chapter content
   */
  async createChapterContent(
    projectId: string,
    chapterId: string,
    data: ChapterContentCreate
  ): Promise<ChapterContentResponse> {
    // Count words
    const wordCount = data.content
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    // Create using unified API
    const unifiedObj = await unifiedObjectService.createObject<ChapterContentData>(
      'chapter_content',
      projectId,
      {
        data: {
          content: data.content,
          wordCount,
        },
        language: data.language || 'en',
        user_request: data.userRequest || 'Initial creation',
        metadata: {
          chapter_id: chapterId,
        },
      }
    );

    // Get version history
    const versions = await unifiedObjectService.getVersions('chapter_content', unifiedObj.id);

    // Convert to legacy format
    return convertToLegacyFormat(unifiedObj, versions);
  },

  /**
   * Get chapter content with all versions
   */
  async getChapterContent(
    projectId: string,
    chapterId: string
  ): Promise<ChapterContentResponse> {
    // Find content ID
    const contentId = await findChapterContentId(projectId, chapterId);

    if (!contentId) {
      throw new Error(`No content found for chapter ${chapterId}`);
    }

    // Get object
    const unifiedObj = await unifiedObjectService.getObject<ChapterContentData>(
      'chapter_content',
      contentId
    );

    // Get version history
    const versions = await unifiedObjectService.getVersions('chapter_content', contentId);

    // Convert to legacy format
    return convertToLegacyFormat(unifiedObj, versions);
  },

  /**
   * Update chapter content (creates new version by default)
   */
  async updateChapterContent(
    projectId: string,
    chapterId: string,
    data: ChapterContentUpdate
  ): Promise<ChapterContentResponse> {
    // Find content ID
    const contentId = await findChapterContentId(projectId, chapterId);

    if (!contentId) {
      throw new Error(`No content found for chapter ${chapterId}`);
    }

    // Count words
    const wordCount = data.content
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    // Update using unified API
    const unifiedObj = await unifiedObjectService.updateObject<ChapterContentData>(
      'chapter_content',
      contentId,
      {
        data: {
          content: data.content,
          wordCount,
        },
        language: data.language || 'en',
        user_request: data.userRequest,
        create_new_version: data.create_new_version !== false, // Default true
      }
    );

    // Get version history
    const versions = await unifiedObjectService.getVersions('chapter_content', contentId);

    // Convert to legacy format
    return convertToLegacyFormat(unifiedObj, versions);
  },

  /**
   * Set active version for chapter content
   */
  async setActiveChapterVersion(
    projectId: string,
    chapterId: string,
    versionId: string
  ): Promise<ChapterContentResponse> {
    // Find content ID
    const contentId = await findChapterContentId(projectId, chapterId);

    if (!contentId) {
      throw new Error(`No content found for chapter ${chapterId}`);
    }

    // Activate version
    await unifiedObjectService.activateVersion('chapter_content', contentId, versionId);

    // Get updated object
    const unifiedObj = await unifiedObjectService.getObject<ChapterContentData>(
      'chapter_content',
      contentId
    );

    // Get version history
    const versions = await unifiedObjectService.getVersions('chapter_content', contentId);

    // Convert to legacy format
    return convertToLegacyFormat(unifiedObj, versions);
  },

  /**
   * Helper: Get chapter content ID from chapter ID
   * Useful for components that need the content ID directly
   */
  async getChapterContentId(projectId: string, chapterId: string): Promise<string | null> {
    return findChapterContentId(projectId, chapterId);
  },
};

export default novelService;

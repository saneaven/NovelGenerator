/**
 * Novel/Manuscript service
 * Now using unified object system
 */

import { unifiedObjectService } from './unifiedObjectService';
import type {
  ManuscriptCreate,
  ManuscriptUpdate,
  ManuscriptResponse,
  ManuscriptVersionResponse,
} from './types';
import type {
  UnifiedObject,
  ManuscriptData,
  VersionHistoryEntry,
} from '../types/unifiedObject';

// ============================================================================
// HELPER: Find manuscript ID from chapter ID
// ============================================================================

/**
 * Find the manuscript object ID for a given chapter ID
 * Returns null if not found
 */
async function findManuscriptId(
  projectId: string,
  chapterId: string
): Promise<string | null> {
  try {
    const result = await unifiedObjectService.listObjects<ManuscriptData>(
      'manuscript',
      projectId,
      { page_size: 100 } // backend limit is 100 per request
    );

    const contentObj = result.objects.find(
      (obj) => obj.metadata.chapter_id === chapterId
    );

    return contentObj?.id || null;
  } catch (error) {
    console.error('[novelService] Error finding manuscript ID:', error);
    return null;
  }
}

// ============================================================================
// CONVERSION: Unified Object → Old Response Format
// ============================================================================

/**
 * Convert UnifiedObject to ManuscriptResponse format
 * This maintains backward compatibility with existing code
 */
function convertToLegacyFormat(
  unifiedObj: UnifiedObject<ManuscriptData>,
  versionHistory?: VersionHistoryEntry[]
): ManuscriptResponse {
  // Convert version history to old format
  const versions: ManuscriptVersionResponse[] = [];

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
        manuscript_id: unifiedObj.id,
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
      manuscript_id: unifiedObj.id,
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
   * Create manuscript
   */
  async createManuscript(
    projectId: string,
    chapterId: string,
    data: ManuscriptCreate
  ): Promise<ManuscriptResponse> {
    // Count words
    const wordCount = data.content
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    // Create using unified API
    const unifiedObj = await unifiedObjectService.createObject<ManuscriptData>(
      'manuscript',
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
    const versions = await unifiedObjectService.getVersions('manuscript', unifiedObj.id);

    // Convert to legacy format
    return convertToLegacyFormat(unifiedObj, versions);
  },

  /**
   * Get manuscript with all versions
   */
  async getManuscript(
    projectId: string,
    chapterId: string
  ): Promise<ManuscriptResponse> {
    // Find manuscript ID
    const manuscriptId = await findManuscriptId(projectId, chapterId);

    if (!manuscriptId) {
      throw new Error(`No manuscript found for chapter ${chapterId}`);
    }

    // Get object
    const unifiedObj = await unifiedObjectService.getObject<ManuscriptData>(
      'manuscript',
      manuscriptId
    );

    // Get version history
    const versions = await unifiedObjectService.getVersions('manuscript', manuscriptId);

    // Convert to legacy format
    return convertToLegacyFormat(unifiedObj, versions);
  },

  /**
   * Update manuscript (creates new version by default)
   */
  async updateManuscript(
    projectId: string,
    chapterId: string,
    data: ManuscriptUpdate
  ): Promise<ManuscriptResponse> {
    // Find manuscript ID
    const manuscriptId = await findManuscriptId(projectId, chapterId);

    if (!manuscriptId) {
      throw new Error(`No manuscript found for chapter ${chapterId}`);
    }

    // Count words
    const wordCount = data.content
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;

    // Update using unified API
    const unifiedObj = await unifiedObjectService.updateObject<ManuscriptData>(
      'manuscript',
      manuscriptId,
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
    const versions = await unifiedObjectService.getVersions('manuscript', manuscriptId);

    // Convert to legacy format
    return convertToLegacyFormat(unifiedObj, versions);
  },

  /**
   * Set active version for manuscript
   */
  async setActiveManuscriptVersion(
    projectId: string,
    chapterId: string,
    versionId: string
  ): Promise<ManuscriptResponse> {
    // Find manuscript ID
    const manuscriptId = await findManuscriptId(projectId, chapterId);

    if (!manuscriptId) {
      throw new Error(`No manuscript found for chapter ${chapterId}`);
    }

    // Activate version
    await unifiedObjectService.activateVersion('manuscript', manuscriptId, versionId);

    // Get updated object
    const unifiedObj = await unifiedObjectService.getObject<ManuscriptData>(
      'manuscript',
      manuscriptId
    );

    // Get version history
    const versions = await unifiedObjectService.getVersions('manuscript', manuscriptId);

    // Convert to legacy format
    return convertToLegacyFormat(unifiedObj, versions);
  },

  /**
   * Helper: Get manuscript ID from chapter ID
   * Useful for components that need the manuscript ID directly
   */
  async getManuscriptId(projectId: string, chapterId: string): Promise<string | null> {
    return findManuscriptId(projectId, chapterId);
  },
};

export default novelService;

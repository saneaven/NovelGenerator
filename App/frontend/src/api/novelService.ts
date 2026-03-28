/**
 * Novel/Manuscript service
 * Uses unified object system
 */

import { unifiedObjectService } from './unifiedObjectService';
import type {
  ManuscriptCreate,
  ManuscriptUpdate,
} from './types';
import type {
  UnifiedObject,
  ManuscriptData,
  VersionHistoryEntry,
} from '../types/unifiedObject';
import { docWordCount, normalizeDoc } from '../editor/manuscript/doc';

// Response type for manuscript operations
export interface ManuscriptWithVersions {
  object: UnifiedObject<ManuscriptData>;
  versions: VersionHistoryEntry[];
}

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
      { page_size: 100 }
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
  ): Promise<ManuscriptWithVersions> {
    const doc = normalizeDoc(data.content);
    const wordCount = docWordCount(doc);

    const object = await unifiedObjectService.createObject<ManuscriptData>(
      'manuscript',
      projectId,
      {
        data: {
          content: doc,
          wordCount,
        },
        language: data.language || 'en',
        rich_text_format: 'tiptap',
        user_request: data.userRequest || 'Initial creation',
        metadata: {
          chapter_id: chapterId,
        },
      }
    );

    const versions = await unifiedObjectService.getVersions('manuscript', object.id);

    return { object, versions };
  },

  /**
   * Get manuscript with all versions
   */
  async getManuscript(
    projectId: string,
    chapterId: string
  ): Promise<ManuscriptWithVersions> {
    const manuscriptId = await findManuscriptId(projectId, chapterId);

    if (!manuscriptId) {
      throw new Error(`No manuscript found for chapter ${chapterId}`);
    }

    const object = await unifiedObjectService.getObject<ManuscriptData>(
      'manuscript',
      manuscriptId,
      undefined,
      'tiptap',
    );

    const versions = await unifiedObjectService.getVersions('manuscript', manuscriptId);

    return { object, versions };
  },

  /**
   * Update manuscript (creates new version by default)
   */
  async updateManuscript(
    projectId: string,
    chapterId: string,
    data: ManuscriptUpdate
  ): Promise<ManuscriptWithVersions> {
    const manuscriptId = await findManuscriptId(projectId, chapterId);

    if (!manuscriptId) {
      throw new Error(`No manuscript found for chapter ${chapterId}`);
    }

    const doc = normalizeDoc(data.content);
    const wordCount = docWordCount(doc);

    const object = await unifiedObjectService.updateObject<ManuscriptData>(
      'manuscript',
      manuscriptId,
      {
        data: {
          content: doc,
          wordCount,
        },
        language: data.language || 'en',
        rich_text_format: 'tiptap',
        user_request: data.userRequest,
        create_new_version: data.create_new_version !== false,
      }
    );

    const versions = await unifiedObjectService.getVersions('manuscript', manuscriptId);

    return { object, versions };
  },

  /**
   * Set active version for manuscript
   */
  async setActiveManuscriptVersion(
    projectId: string,
    chapterId: string,
    versionId: string
  ): Promise<ManuscriptWithVersions> {
    const manuscriptId = await findManuscriptId(projectId, chapterId);

    if (!manuscriptId) {
      throw new Error(`No manuscript found for chapter ${chapterId}`);
    }

    await unifiedObjectService.restoreVersion('manuscript', manuscriptId, versionId, 'tiptap');

    const object = await unifiedObjectService.getObject<ManuscriptData>(
      'manuscript',
      manuscriptId,
      undefined,
      'tiptap',
    );

    const versions = await unifiedObjectService.getVersions('manuscript', manuscriptId);

    return { object, versions };
  },

  /**
   * Helper: Get manuscript ID from chapter ID
   */
  async getManuscriptId(projectId: string, chapterId: string): Promise<string | null> {
    return findManuscriptId(projectId, chapterId);
  },
};

export default novelService;

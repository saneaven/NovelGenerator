/**
 * Novel Editor Function Call Applicator
 *
 * Handles applying function calls specifically for the novel editor (manuscript editing).
 * Supports the new replace/patch function structure:
 * - replace_manuscript: Full content replacement
 * - patch_manuscript: Search and replace within content
 */

import type { FunctionCallMetadata } from '../../../llm/requestTypes';
import type { UnifiedObject, UpdateObjectRequest } from '../../../types/unifiedObject';
import type { PatchRetryContext } from '../../../types/patchTypes';
import { applyPatch } from '../../../utils/patchUtils';

export interface NovelEditorFunctionCallResult {
  success: boolean;
  message: string;
  error?: string;
  /** Contexts for fields that need retry (patch failed) */
  retryContexts?: PatchRetryContext[];
}

export interface UnifiedStoreActions {
  getManuscriptByChapterId: (chapterId: string) => UnifiedObject | null;
  updateObject: (type: 'manuscript', id: string, request: UpdateObjectRequest) => Promise<void>;
  listObjects: (type: 'manuscript', projectId: string) => Promise<UnifiedObject[]>;
  createObject: (
    type: 'manuscript',
    projectId: string,
    data: any,
    language: string,
    metadata?: Record<string, any>
  ) => Promise<UnifiedObject>;
}

export interface ApplicatorConfig {
  store: UnifiedStoreActions;
  language: string;
}

export class NovelEditorFunctionCallApplicator {
  private store: UnifiedStoreActions;
  private language: string;

  constructor(config: ApplicatorConfig) {
    this.store = config.store;
    this.language = config.language;
  }

  async applyFunctionCall(
    projectId: string,
    functionCall: FunctionCallMetadata
  ): Promise<NovelEditorFunctionCallResult> {
    try {
      switch (functionCall.function_name) {
        case 'replace_manuscript':
          return await this.applyReplaceManuscript(projectId, functionCall.arguments);

        case 'patch_manuscript':
          return await this.applyPatchManuscript(projectId, functionCall.arguments);

        // Legacy support for old function name
        case 'update_manuscript':
          return await this.applyLegacyUpdateManuscript(projectId, functionCall.arguments);

        default:
          return {
            success: false,
            message: 'Unknown function name',
            error: `Unsupported function: ${functionCall.function_name}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        message: 'Failed to apply function call',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Handle replace_manuscript function call (full content replacement)
   */
  private async applyReplaceManuscript(
    projectId: string,
    args: any
  ): Promise<NovelEditorFunctionCallResult> {
    console.log('NovelEditorFunctionCallApplicator: applyReplaceManuscript called', { projectId, args });

    if (!args || !args.chapterId || args.content === undefined) {
      return {
        success: false,
        message: 'Invalid replace_manuscript arguments',
        error: 'Function must receive chapterId and content',
      };
    }

    try {
      const manuscriptObj = await this.ensureManuscript(projectId, args.chapterId);
      const wordCount = args.content.trim().split(/\s+/).filter(Boolean).length;

      await this.store.updateObject('manuscript', manuscriptObj.id, {
        data: {
          content: args.content,
          wordCount,
        },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Generated Content',
      });

      return {
        success: true,
        message: 'Successfully updated manuscript',
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to update manuscript',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Handle patch_manuscript function call (search and replace)
   */
  private async applyPatchManuscript(
    projectId: string,
    args: any
  ): Promise<NovelEditorFunctionCallResult> {
    console.log('NovelEditorFunctionCallApplicator: applyPatchManuscript called', { projectId, args });

    if (!args || !args.chapterId || !args.replacements) {
      return {
        success: false,
        message: 'Invalid patch_manuscript arguments',
        error: 'Function must receive chapterId and replacements',
      };
    }

    try {
      const manuscriptObj = await this.ensureManuscript(projectId, args.chapterId);
      const currentData = manuscriptObj.data[this.language] || {};
      const currentContent = currentData.content || '';
      const retryContexts: PatchRetryContext[] = [];

      // Apply all replacements
      const result = applyPatch(currentContent, args.replacements as Array<{ old: string; new: string }>);

      if (!result.success) {
        retryContexts.push({
          objectId: manuscriptObj.id,
          fieldName: 'content',
          currentValue: currentContent,
          error: result.error || 'Patch application failed',
        });
      }

      const wordCount = result.value.trim().split(/\s+/).filter(Boolean).length;

      await this.store.updateObject('manuscript', manuscriptObj.id, {
        data: {
          content: result.value,
          wordCount,
        },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Generated Content',
      });

      if (retryContexts.length > 0) {
        return {
          success: false,
          message: 'Updated manuscript with patch failure(s)',
          retryContexts,
        };
      }

      return {
        success: true,
        message: 'Successfully updated manuscript',
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to update manuscript',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Legacy support for update_manuscript function (for backward compatibility)
   * Accepts either plain string content or the old patchable field format
   */
  private async applyLegacyUpdateManuscript(
    projectId: string,
    args: any
  ): Promise<NovelEditorFunctionCallResult> {
    console.log('NovelEditorFunctionCallApplicator: applyLegacyUpdateManuscript called', { projectId, args });

    if (!args || !args.chapterId || !args.content) {
      return {
        success: false,
        message: 'Invalid update_manuscript arguments',
        error: 'Function must receive chapterId and content',
      };
    }

    try {
      const manuscriptObj = await this.ensureManuscript(projectId, args.chapterId);
      const currentData = manuscriptObj.data[this.language] || {};
      const currentContent = currentData.content || '';

      let resolvedContent: string;

      if (typeof args.content === 'string') {
        // Plain string - direct replacement
        resolvedContent = args.content;
      } else if (args.content && typeof args.content === 'object') {
        // Old patchable field format: { operation: 'replace'|'patch', datas: [...] }
        if (args.content.operation === 'replace' && Array.isArray(args.content.datas)) {
          resolvedContent = args.content.datas[0] || currentContent;
        } else {
          // Unsupported format, use current content
          resolvedContent = currentContent;
        }
      } else {
        resolvedContent = currentContent;
      }

      const wordCount = resolvedContent.trim().split(/\s+/).filter(Boolean).length;

      await this.store.updateObject('manuscript', manuscriptObj.id, {
        data: {
          content: resolvedContent,
          wordCount,
        },
        language: this.language,
        create_new_version: true,
        user_request: 'AI Generated Content',
      });

      return {
        success: true,
        message: 'Successfully updated manuscript',
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to update manuscript',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Ensure manuscript exists for a chapter, creating if necessary
   */
  private async ensureManuscript(projectId: string, chapterId: string): Promise<UnifiedObject> {
    // Try to find in store first
    let manuscriptObj = this.store.getManuscriptByChapterId(chapterId);

    // If not in store, try to fetch from API
    if (!manuscriptObj) {
      console.log('NovelEditorFunctionCallApplicator: Manuscript not in store, fetching from API...');
      const manuscripts = await this.store.listObjects('manuscript', projectId);
      manuscriptObj = manuscripts.find((m) => m.metadata?.chapter_id === chapterId) || null;
    }

    // If still not found, create new manuscript
    if (!manuscriptObj) {
      console.log('NovelEditorFunctionCallApplicator: Manuscript not found, creating new one...');
      manuscriptObj = await this.store.createObject(
        'manuscript',
        projectId,
        { content: '', wordCount: 0 },
        this.language,
        { chapter_id: chapterId }
      );
    }

    return manuscriptObj;
  }
}

/**
 * Patch Handlers
 *
 * Handlers for search-replace patch operations:
 * - patch_basic_info
 * - patch_story_object
 * - patch_chapter_outline
 * - patch_manuscript
 */

import type { ApplicationResult, PatchRetryContext, StoryObjectSubtype } from '../../types';
import { getObjectData } from '../../types';
import type { HandlerContext } from '../types';
import type { ObjectType, UnifiedObject } from '../../../types/unifiedObject';
import type { Replacement } from '../../../types/patchTypes';
import { applyPatch } from '../../../utils/patchUtils';

/** Maps story object subtype to unified object type */
const STORY_OBJECT_TYPE_MAP: Record<StoryObjectSubtype, ObjectType> = {
  character: 'character',
  location: 'location',
  organization: 'organization',
  lorebook: 'lorebook',
  act: 'act',
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function ok(message: string, data?: Record<string, unknown>): ApplicationResult {
  return { success: true, message, data };
}

function error(message: string): ApplicationResult {
  return { success: false, message, error: message };
}

async function ensureObject(
  store: HandlerContext['store'],
  type: ObjectType,
  id: string
): Promise<UnifiedObject> {
  let object = store.getObject(id);
  if (!object) {
    await store.fetchObject(type, id);
    object = store.getObject(id);
  }
  if (!object) {
    throw new Error(`${type} with id ${id} not found`);
  }
  return object;
}

function buildPatchResult(
  objectId: string,
  objectType: string | undefined,
  retryContexts: PatchRetryContext[],
  totalReplacements: number,
  successMessage: string
): ApplicationResult {
  if (retryContexts.length > 0) {
    const failureCount = retryContexts.length;
    const successCount = totalReplacements - failureCount;
    const statusMsg = successCount > 0
      ? `${objectType ?? 'Object'} patch: ${successCount} succeeded, ${failureCount} failed`
      : `${objectType ?? 'Object'} patch: ${failureCount} failed`;
    const errorDetails = retryContexts.map(ctx => `[${ctx.fieldName}] ${ctx.error}`).join('\n');

    return {
      success: false,
      message: statusMsg,
      error: errorDetails,
      objectId,
      objectType,
      retryContexts,
    };
  }

  return ok(successMessage, { id: objectId });
}

// ============================================================================
// PATCH HANDLERS
// ============================================================================

/**
 * Patch basic info fields using search and replace
 */
export async function patchBasicInfo(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { replacements } = args as { replacements?: Replacement[] };

  if (!replacements || !Array.isArray(replacements)) {
    return error('Missing replacements for patch_basic_info');
  }

  const { store, projectId, language } = context;

  const existing = await store.listObjects('basic_info', projectId);
  if (existing.length === 0) {
    return error('No basic info found to patch');
  }

  const basic = existing[0];
  const currentData = getObjectData(basic, language);
  const retryContexts: PatchRetryContext[] = [];

  // Apply patches to each field
  const newData: Record<string, string> = {
    title: (currentData.title as string) ?? '',
    logline: (currentData.logline as string) ?? '',
    genre: (currentData.genre as string) ?? '',
  };

  for (const r of replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) continue;

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
    } else {
      retryContexts.push({
        objectId: basic.id,
        fieldName: r.field,
        currentValue: newData[r.field],
        error: result.error || 'Patch failed',
      });
    }
  }

  await store.updateObject('basic_info', basic.id, {
    data: newData,
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return buildPatchResult(basic.id, 'basic_info', retryContexts, replacements.length, 'Updated basic info');
}

/**
 * Patch story object fields using search and replace
 */
export async function patchStoryObject(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type, replacements } = args as {
    id?: string;
    type?: string;
    replacements?: Replacement[];
  };

  if (!id || !type || !replacements) {
    return error('Missing required fields for patch_story_object');
  }

  const objectType = STORY_OBJECT_TYPE_MAP[type as StoryObjectSubtype];
  if (!objectType) {
    return error(`Unknown story object type: ${type}`);
  }

  const { store, language } = context;

  const object = await ensureObject(store, objectType, id);
  const currentData = getObjectData(object, language);
  const retryContexts: PatchRetryContext[] = [];

  const newData: Record<string, string> = {
    name: (currentData.name as string) ?? '',
    description: (currentData.description as string) ?? '',
  };

  for (const r of replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) continue;

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
    } else {
      retryContexts.push({
        objectId: id,
        objectType: type,
        fieldName: r.field,
        currentValue: newData[r.field],
        error: result.error || 'Patch failed',
      });
    }
  }

  await store.updateObject(objectType, id, {
    data: newData,
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return buildPatchResult(id, type, retryContexts, replacements.length, `Updated ${type}`);
}

/**
 * Patch chapter outline fields using search and replace
 */
export async function patchChapterOutline(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, replacements, order } = args as {
    id?: string;
    replacements?: Replacement[];
    order?: number;
  };

  if (!id || !replacements) {
    return error('Missing required fields for patch_chapter_outline');
  }

  const { store, language } = context;

  const object = await ensureObject(store, 'chapter', id);
  const currentData = getObjectData(object, language);
  const retryContexts: PatchRetryContext[] = [];

  const newData: Record<string, string> = {
    name: (currentData.name as string) ?? '',
    description: (currentData.description as string) ?? '',
  };

  for (const r of replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) continue;

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
    } else {
      retryContexts.push({
        objectId: id,
        objectType: 'chapter',
        fieldName: r.field,
        currentValue: newData[r.field],
        error: result.error || 'Patch failed',
      });
    }
  }

  // Build metadata for order change
  const metadata: Record<string, unknown> = {};
  if (order !== undefined && typeof order === 'number') {
    metadata.order = order;
  }

  await store.updateObject('chapter', id, {
    data: newData,
    language,
    create_new_version: true,
    user_request: 'AI Edit',
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });

  return buildPatchResult(id, 'chapter', retryContexts, replacements.length, 'Updated chapter');
}

/**
 * Patch manuscript content using search and replace
 */
export async function patchManuscript(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, replacements } = args as {
    id?: string;
    replacements?: Array<{ old: string; new: string }>;
  };

  if (!id || !replacements) {
    return error('Missing required fields for patch_manuscript');
  }

  const { store, language } = context;

  // Ensure manuscript is in cache (fetch from API if needed)
  const manuscript = await ensureObject(store, 'manuscript', id);

  const currentData = getObjectData(manuscript, language);
  const currentContent = (currentData.content as string) ?? '';
  const retryContexts: PatchRetryContext[] = [];

  // Apply all replacements to content
  const result = applyPatch(currentContent, replacements);

  if (!result.success) {
    retryContexts.push({
      objectId: manuscript.id,
      fieldName: 'content',
      currentValue: currentContent,
      error: result.error || 'Patch failed',
    });
  }

  const wordCount = result.value.trim().split(/\s+/).filter(Boolean).length;

  await store.updateObject('manuscript', manuscript.id, {
    data: { content: result.value, wordCount },
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  if (retryContexts.length > 0) {
    const successCount = result.successCount ?? 0;
    const failureCount = result.failureCount ?? 0;
    const statusMsg = successCount > 0
      ? `Manuscript patch: ${successCount} succeeded, ${failureCount} failed`
      : `Manuscript patch: ${failureCount} failed`;

    return {
      success: false,
      message: statusMsg,
      error: result.error,
      objectId: manuscript.id,
      objectType: 'manuscript',
      retryContexts,
    };
  }

  return ok('Updated manuscript', { id: manuscript.id });
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const PATCH_HANDLERS = {
  patch_basic_info: patchBasicInfo,
  patch_story_object: patchStoryObject,
  patch_chapter_outline: patchChapterOutline,
  patch_manuscript: patchManuscript,
};

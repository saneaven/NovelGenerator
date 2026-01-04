/**
 * Patch Handlers
 *
 * Handlers for search-replace patch operations:
 * - patch_basic_info
 * - patch_story_object
 * - patch_manuscript
 * - patch_outline / patch_outline_act / patch_outline_chapter
 */

import type { ApplicationResult } from '../../types';
import { getObjectData, ALL_OBJECT_TYPE_MAP } from '../../types';
import type { HandlerContext, HandlerOptions } from '../types';
import { CRUD_OPTIONS } from '../types';
import type { ObjectType, UnifiedObject } from '../../../types/unifiedObject';
import type { Replacement } from '../../../types/patchTypes';
import { applyPatch } from '../../../utils/patchUtils';

/** Internal structure for tracking patch failures (for error messages only) */
interface PatchFailure {
  fieldName: string;
  error: string;
}

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
  failures: PatchFailure[],
  totalReplacements: number,
  successMessage: string
): ApplicationResult {
  if (failures.length > 0) {
    const failureCount = failures.length;
    const successCount = totalReplacements - failureCount;
    const statusMsg = successCount > 0
      ? `${objectType ?? 'Object'} patch: ${successCount} succeeded, ${failureCount} failed`
      : `${objectType ?? 'Object'} patch: ${failureCount} failed`;
    const errorDetails = failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n');

    return {
      success: false,
      message: statusMsg,
      error: errorDetails,
      objectId,
      objectType,
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
  context: HandlerContext,
  options: HandlerOptions = CRUD_OPTIONS
): Promise<ApplicationResult> {
  const { replacements } = args as { replacements?: Replacement[] };

  if (!replacements || !Array.isArray(replacements)) {
    return error('Missing replacements for patch_basic_info');
  }

  const { store, projectId, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = options;

  const existing = await store.listObjects('basic_info', projectId);
  if (existing.length === 0) {
    return error('No basic info found to patch');
  }

  const basic = existing[0];
  const currentData = getObjectData(basic, language);
  const failures: PatchFailure[] = [];

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
      failures.push({
        fieldName: r.field,
        error: result.error || 'Patch failed',
      });
    }
  }

  await store.updateObject('basic_info', basic.id, {
    data: newData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return buildPatchResult(basic.id, 'basic_info', failures, replacements.length, 'Updated basic info');
}

/**
 * Patch story object fields using search and replace.
 * Also used for translation via patch_object_translation (with ALL_OBJECT_TYPE_MAP).
 * Note: Validation (id, type, replacements, object existence) is done before this handler runs.
 */
export async function patchStoryObject(
  args: Record<string, unknown>,
  context: HandlerContext,
  options: HandlerOptions = CRUD_OPTIONS
): Promise<ApplicationResult> {
  // Args are pre-validated
  const { id, type, replacements } = args as {
    id: string;
    type: string;
    replacements: Replacement[];
  };

  // Use ALL_OBJECT_TYPE_MAP to support both story objects and outline types (for translation)
  const objectType = ALL_OBJECT_TYPE_MAP[type];
  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = options;

  // Object should be in cache from validation, but fetch if needed for safety
  const object = await ensureObject(store, objectType, id);
  const currentData = getObjectData(object, language);
  const failures: PatchFailure[] = [];

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
      failures.push({
        fieldName: r.field,
        error: result.error || 'Patch failed',
      });
    }
  }

  await store.updateObject(objectType, id, {
    data: newData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return buildPatchResult(id, type, failures, replacements.length, `Updated ${type}`);
}

/**
 * Patch manuscript content using search and replace
 */
export async function patchManuscript(
  args: Record<string, unknown>,
  context: HandlerContext,
  options: HandlerOptions = CRUD_OPTIONS
): Promise<ApplicationResult> {
  const { id, replacements } = args as {
    id?: string;
    replacements?: Array<{ old: string; new: string }>;
  };

  if (!id || !replacements) {
    return error('Missing required fields for patch_manuscript');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = options;

  // Ensure manuscript is in cache (fetch from API if needed)
  const manuscript = await ensureObject(store, 'manuscript', id);

  const currentData = getObjectData(manuscript, language);
  const currentContent = (currentData.content as string) ?? '';
  const failures: PatchFailure[] = [];

  // Apply all replacements to content
  const result = applyPatch(currentContent, replacements);

  if (!result.success) {
    failures.push({
      fieldName: 'content',
      error: result.error || 'Patch failed',
    });
  }

  const wordCount = result.value.trim().split(/\s+/).filter(Boolean).length;

  await store.updateObject('manuscript', manuscript.id, {
    data: { content: result.value, wordCount },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  if (failures.length > 0) {
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
    };
  }

  return ok('Updated manuscript', { id: manuscript.id });
}

// ============================================================================
// OUTLINE PATCH HANDLERS
// ============================================================================

/**
 * Patch outline fields using search and replace
 */
export async function patchOutline(
  args: Record<string, unknown>,
  context: HandlerContext,
  options: HandlerOptions = CRUD_OPTIONS
): Promise<ApplicationResult> {
  const { id, replacements } = args as {
    id?: string;
    replacements?: Replacement[];
  };

  if (!id || !replacements) {
    return error('Missing required fields for patch_outline');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = options;

  const object = await ensureObject(store, 'outline', id);
  const currentData = getObjectData(object, language);
  const failures: PatchFailure[] = [];

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
      failures.push({
        fieldName: r.field,
        error: result.error || 'Patch failed',
      });
    }
  }

  await store.updateObject('outline', id, {
    data: newData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return buildPatchResult(id, 'outline', failures, replacements.length, 'Updated outline');
}

/**
 * Patch act fields using search and replace
 */
export async function patchOutlineAct(
  args: Record<string, unknown>,
  context: HandlerContext,
  options: HandlerOptions = CRUD_OPTIONS
): Promise<ApplicationResult> {
  const { id, replacements, order } = args as {
    id?: string;
    replacements?: Replacement[];
    order?: number;
  };

  if (!id || !replacements) {
    return error('Missing required fields for patch_outline_act');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = options;

  const object = await ensureObject(store, 'act', id);
  const currentData = getObjectData(object, language);
  const failures: PatchFailure[] = [];

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
      failures.push({
        fieldName: r.field,
        error: result.error || 'Patch failed',
      });
    }
  }

  // Build metadata for order change
  const metadata: Record<string, unknown> = {};
  if (order !== undefined && typeof order === 'number') {
    metadata.order = order;
  }

  await store.updateObject('act', id, {
    data: newData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });

  return buildPatchResult(id, 'act', failures, replacements.length, 'Updated act');
}

/**
 * Patch chapter fields using search and replace (outline-prefixed version)
 */
export async function patchOutlineChapter(
  args: Record<string, unknown>,
  context: HandlerContext,
  options: HandlerOptions = CRUD_OPTIONS
): Promise<ApplicationResult> {
  const { id, replacements, order } = args as {
    id?: string;
    replacements?: Replacement[];
    order?: number;
  };

  if (!id || !replacements) {
    return error('Missing required fields for patch_outline_chapter');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = options;

  const object = await ensureObject(store, 'chapter', id);
  const currentData = getObjectData(object, language);
  const failures: PatchFailure[] = [];

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
      failures.push({
        fieldName: r.field,
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
    create_new_version: createNewVersion,
    user_request: userRequest,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });

  return buildPatchResult(id, 'chapter', failures, replacements.length, 'Updated chapter');
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const PATCH_HANDLERS = {
  // Basic handlers
  patch_basic_info: patchBasicInfo,
  patch_story_object: patchStoryObject,
  patch_manuscript: patchManuscript,
  // Outline handlers
  patch_outline: patchOutline,
  patch_outline_act: patchOutlineAct,
  patch_outline_chapter: patchOutlineChapter,
};

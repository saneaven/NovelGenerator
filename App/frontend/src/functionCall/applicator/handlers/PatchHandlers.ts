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
import type { HandlerContext } from '../types';
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
  params: {
    objectId: string;
    objectType: string | undefined;
    successCount: number;
    failureCount: number;
    totalCount: number;
    errorDetails?: string;
    successMessage: string;
  }
): ApplicationResult {
  const { objectId, objectType, successCount, failureCount, totalCount, errorDetails, successMessage } = params;

  const data = { id: objectId, successCount, failureCount, totalCount };

  if (failureCount > 0) {
    const statusMsg = successCount > 0
      ? `${objectType ?? 'Object'} patch: ${successCount} succeeded, ${failureCount} failed`
      : `${objectType ?? 'Object'} patch: ${failureCount} failed`;

    return {
      success: false,
      message: statusMsg,
      error: errorDetails ?? 'Patch failed',
      objectId,
      objectType,
      data,
    };
  }

  return ok(successMessage, data);
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
  if (replacements.length === 0) {
    return error('No replacements provided for patch_basic_info');
  }

  const { store, projectId, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const existing = await store.listObjects('basic_info', projectId);
  if (existing.length === 0) {
    return error('No basic info found to patch');
  }

  const basic = existing[0];
  const currentData = getObjectData(basic, language);
  const failures: PatchFailure[] = [];
  let appliedCount = 0;

  // Apply patches to each field
  const newData: Record<string, string> = {
    title: (currentData.title as string) ?? '',
    logline: (currentData.logline as string) ?? '',
    genre: (currentData.genre as string) ?? '',
  };

  for (const r of replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) {
      failures.push({ fieldName: r.field ?? 'unknown', error: 'Unknown field' });
      continue;
    }

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
      appliedCount += 1;
    } else {
      failures.push({
        fieldName: r.field,
        error: result.error || 'Patch failed',
      });
    }
  }

  const failureCount = failures.length;
  const totalCount = replacements.length;

  if (appliedCount === 0) {
    return buildPatchResult({
      objectId: basic.id,
      objectType: 'basic_info',
      successCount: 0,
      failureCount,
      totalCount,
      errorDetails: failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n'),
      successMessage: 'Updated basic info',
    });
  }

  await store.updateObject('basic_info', basic.id, {
    data: newData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return buildPatchResult({
    objectId: basic.id,
    objectType: 'basic_info',
    successCount: appliedCount,
    failureCount,
    totalCount,
    errorDetails: failures.length > 0 ? failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n') : undefined,
    successMessage: 'Updated basic info',
  });
}

/**
 * Patch story object fields using search and replace.
 * Also used for translation via patch_object_translation (with ALL_OBJECT_TYPE_MAP).
 * Note: Validation (id, type, replacements, object existence) is done before this handler runs.
 */
export async function patchStoryObject(
  args: Record<string, unknown>,
  context: HandlerContext
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
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  // Object should be in cache from validation, but fetch if needed for safety
  const object = await ensureObject(store, objectType, id);
  const currentData = getObjectData(object, language);
  const failures: PatchFailure[] = [];
  let appliedCount = 0;

  const newData: Record<string, string> = {
    name: (currentData.name as string) ?? '',
    description: (currentData.description as string) ?? '',
  };

  for (const r of replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) {
      failures.push({ fieldName: r.field ?? 'unknown', error: 'Unknown field' });
      continue;
    }

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
      appliedCount += 1;
    } else {
      failures.push({
        fieldName: r.field,
        error: result.error || 'Patch failed',
      });
    }
  }

  const failureCount = failures.length;
  const totalCount = replacements.length;

  if (appliedCount === 0) {
    return buildPatchResult({
      objectId: id,
      objectType: type,
      successCount: 0,
      failureCount,
      totalCount,
      errorDetails: failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n'),
      successMessage: `Updated ${type}`,
    });
  }

  await store.updateObject(objectType, id, {
    data: newData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return buildPatchResult({
    objectId: id,
    objectType: type,
    successCount: appliedCount,
    failureCount,
    totalCount,
    errorDetails: failures.length > 0 ? failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n') : undefined,
    successMessage: `Updated ${type}`,
  });
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
  if (replacements.length === 0) {
    return error('No replacements provided for patch_manuscript');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  // Ensure manuscript is in cache (fetch from API if needed)
  const manuscript = await ensureObject(store, 'manuscript', id);

  const currentData = getObjectData(manuscript, language);
  const currentContent = (currentData.content as string) ?? '';
  // Apply all replacements to content
  const result = applyPatch(currentContent, replacements);

  const successCount = result.successCount ?? 0;
  const failureCount = result.failureCount ?? 0;
  const totalCount = replacements.length;

  if (successCount === 0) {
    return {
      success: false,
      message: `Manuscript patch: ${failureCount} failed`,
      error: result.error,
      objectId: manuscript.id,
      objectType: 'manuscript',
      data: { id: manuscript.id, successCount, failureCount, totalCount },
    };
  }

  const wordCount = result.value.trim().split(/\s+/).filter(Boolean).length;

  await store.updateObject('manuscript', manuscript.id, {
    data: { content: result.value, wordCount },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  if (failureCount > 0) {
    const statusMsg = successCount > 0
      ? `Manuscript patch: ${successCount} succeeded, ${failureCount} failed`
      : `Manuscript patch: ${failureCount} failed`;

    return {
      success: false,
      message: statusMsg,
      error: result.error,
      objectId: manuscript.id,
      objectType: 'manuscript',
      data: { id: manuscript.id, successCount, failureCount, totalCount },
    };
  }

  return ok('Updated manuscript', { id: manuscript.id, successCount, failureCount: 0, totalCount });
}

// ============================================================================
// OUTLINE PATCH HANDLERS
// ============================================================================

/**
 * Patch outline fields using search and replace
 */
export async function patchOutline(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, replacements } = args as {
    id?: string;
    replacements?: Replacement[];
  };

  if (!id || !replacements) {
    return error('Missing required fields for patch_outline');
  }
  if (replacements.length === 0) {
    return error('No replacements provided for patch_outline');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, 'outline', id);
  const currentData = getObjectData(object, language);
  const failures: PatchFailure[] = [];
  let appliedCount = 0;

  const newData: Record<string, string> = {
    name: (currentData.name as string) ?? '',
    description: (currentData.description as string) ?? '',
  };

  for (const r of replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) {
      failures.push({ fieldName: r.field ?? 'unknown', error: 'Unknown field' });
      continue;
    }

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
      appliedCount += 1;
    } else {
      failures.push({
        fieldName: r.field,
        error: result.error || 'Patch failed',
      });
    }
  }

  const failureCount = failures.length;
  const totalCount = replacements.length;

  if (appliedCount === 0) {
    return buildPatchResult({
      objectId: id,
      objectType: 'outline',
      successCount: 0,
      failureCount,
      totalCount,
      errorDetails: failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n'),
      successMessage: 'Updated outline',
    });
  }

  await store.updateObject('outline', id, {
    data: newData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return buildPatchResult({
    objectId: id,
    objectType: 'outline',
    successCount: appliedCount,
    failureCount,
    totalCount,
    errorDetails: failures.length > 0 ? failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n') : undefined,
    successMessage: 'Updated outline',
  });
}

/**
 * Patch act fields using search and replace
 */
export async function patchOutlineAct(
  args: Record<string, unknown>,
  context: HandlerContext
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
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, 'act', id);
  const currentData = getObjectData(object, language);
  const failures: PatchFailure[] = [];
  let appliedCount = 0;

  const newData: Record<string, string> = {
    name: (currentData.name as string) ?? '',
    description: (currentData.description as string) ?? '',
  };

  for (const r of replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) {
      failures.push({ fieldName: r.field ?? 'unknown', error: 'Unknown field' });
      continue;
    }

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
      appliedCount += 1;
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

  const orderOpCount = Object.keys(metadata).length > 0 ? 1 : 0;
  const failureCount = failures.length;
  const totalCount = replacements.length + orderOpCount;
  const successCount = appliedCount + orderOpCount;

  if (totalCount === 0) {
    return error('No changes provided for patch_outline_act');
  }

  if (successCount === 0) {
    return buildPatchResult({
      objectId: id,
      objectType: 'act',
      successCount: 0,
      failureCount,
      totalCount,
      errorDetails: failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n'),
      successMessage: 'Updated act',
    });
  }

  await store.updateObject('act', id, {
    data: newData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });

  return buildPatchResult({
    objectId: id,
    objectType: 'act',
    successCount,
    failureCount,
    totalCount,
    errorDetails: failures.length > 0 ? failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n') : undefined,
    successMessage: 'Updated act',
  });
}

/**
 * Patch chapter fields using search and replace (outline-prefixed version)
 */
export async function patchOutlineChapter(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, replacements, order, actId } = args as {
    id?: string;
    replacements?: Replacement[];
    order?: number;
    actId?: string;
  };

  if (!id || !replacements) {
    return error('Missing required fields for patch_outline_chapter');
  }

  if (actId !== undefined && (typeof actId !== 'string' || !actId.trim())) {
    return error('Invalid actId for patch_outline_chapter');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, 'chapter', id);
  const currentData = getObjectData(object, language);
  const failures: PatchFailure[] = [];
  let appliedCount = 0;

  const newData: Record<string, string> = {
    name: (currentData.name as string) ?? '',
    description: (currentData.description as string) ?? '',
  };

  for (const r of replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) {
      failures.push({ fieldName: r.field ?? 'unknown', error: 'Unknown field' });
      continue;
    }

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
      appliedCount += 1;
    } else {
      failures.push({
        fieldName: r.field,
        error: result.error || 'Patch failed',
      });
    }
  }

  // Build metadata for order change
  const metadata: Record<string, unknown> = {};
  if (actId) {
    metadata.act_id = actId;
  }
  if (order !== undefined && typeof order === 'number') {
    metadata.order = order;
  }

  const metadataOpCount = (actId ? 1 : 0) + (order !== undefined && typeof order === 'number' ? 1 : 0);
  const failureCount = failures.length;
  const totalCount = replacements.length + metadataOpCount;
  const successCount = appliedCount + metadataOpCount;

  if (totalCount === 0) {
    return error('No changes provided for patch_outline_chapter');
  }

  if (successCount === 0) {
    return buildPatchResult({
      objectId: id,
      objectType: 'chapter',
      successCount: 0,
      failureCount,
      totalCount,
      errorDetails: failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n'),
      successMessage: 'Updated chapter',
    });
  }

  await store.updateObject('chapter', id, {
    data: newData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });

  return buildPatchResult({
    objectId: id,
    objectType: 'chapter',
    successCount,
    failureCount,
    totalCount,
    errorDetails: failures.length > 0 ? failures.map(f => `[${f.fieldName}] ${f.error}`).join('\n') : undefined,
    successMessage: 'Updated chapter',
  });
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

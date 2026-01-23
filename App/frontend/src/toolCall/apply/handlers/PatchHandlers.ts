/**
 * Apply Handlers - Patch
 *
 * Handlers for search-replace patch operations:
 * - patch_basic_info
 * - patch_story_object
 * - patch_outline / patch_outline_act / patch_outline_chapter
 *
 * Each patch function handles a single replacement (field, old, new).
 * For multiple edits, the caller should make multiple patch calls.
 */

import type { ApplicationResult } from '../../types';
import { getObjectData, ALL_OBJECT_TYPE_MAP } from '../../types';
import type { HandlerContext } from '../types';
import type { ObjectType, UnifiedObject } from '../../../types/unifiedObject';
import { applySingleReplacement } from '../../../utils/patchUtils';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function ok(message: string, data?: Record<string, unknown>): ApplicationResult {
  return { success: true, message, data };
}

function error(message: string, objectId?: string, objectType?: string): ApplicationResult {
  return { success: false, message, error: message, objectId, objectType };
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

// ============================================================================
// PATCH HANDLERS
// ============================================================================

/**
 * Patch a basic info field using search and replace
 */
export async function patchBasicInfo(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { field, old: oldText, new: newText } = args as {
    field?: string;
    old?: string;
    new?: string;
  };

  if (!field || !oldText || newText === undefined) {
    return error('Missing required fields (field, old, new) for patch_basic_info');
  }

  const validFields = ['title', 'logline', 'genre'];
  if (!validFields.includes(field)) {
    return error(`Invalid field "${field}" for patch_basic_info. Valid fields: ${validFields.join(', ')}`);
  }

  const { store, projectId, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const existing = await store.listObjects('basic_info', projectId);
  if (existing.length === 0) {
    return error('No basic info found to patch');
  }

  const basic = existing[0];
  const currentData = getObjectData(basic, language);
  const currentValue = (currentData[field] as string) ?? '';

  const result = applySingleReplacement(currentValue, oldText, newText);
  if (!result.success) {
    return error(`[${field}] ${result.error}`, basic.id, 'basic_info');
  }

  await store.updateObject('basic_info', basic.id, {
    data: { ...currentData, [field]: result.value },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return ok('Updated basic info', { id: basic.id, field });
}

/**
 * Patch a story object field using search and replace.
 * Also used for translation via patch_object_translation (with ALL_OBJECT_TYPE_MAP).
 */
export async function patchStoryObject(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type, field, old: oldText, new: newText } = args as {
    id?: string;
    type?: string;
    field?: string;
    old?: string;
    new?: string;
  };

  if (!id || !type || !field || !oldText || newText === undefined) {
    return error('Missing required fields (id, type, field, old, new) for patch_story_object');
  }

  const validFields = ['name', 'description'];
  if (!validFields.includes(field)) {
    return error(`Invalid field "${field}" for patch_story_object. Valid fields: ${validFields.join(', ')}`, id, type);
  }

  // Use ALL_OBJECT_TYPE_MAP to support both story objects and outline types (for translation)
  const objectType = ALL_OBJECT_TYPE_MAP[type];
  if (!objectType) {
    return error(`Unknown object type: ${type}`, id, type);
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, objectType, id);
  const currentData = getObjectData(object, language);
  const currentValue = (currentData[field] as string) ?? '';

  const result = applySingleReplacement(currentValue, oldText, newText);
  if (!result.success) {
    return error(`[${field}] ${result.error}`, id, type);
  }

  await store.updateObject(objectType, id, {
    data: { ...currentData, [field]: result.value },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return ok(`Updated ${type}`, { id, field });
}

// ============================================================================
// OUTLINE PATCH HANDLERS
// ============================================================================

/**
 * Patch an outline field using search and replace
 */
export async function patchOutline(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, field, old: oldText, new: newText } = args as {
    id?: string;
    field?: string;
    old?: string;
    new?: string;
  };

  if (!id || !field || !oldText || newText === undefined) {
    return error('Missing required fields (id, field, old, new) for patch_outline');
  }

  const validFields = ['name', 'description'];
  if (!validFields.includes(field)) {
    return error(`Invalid field "${field}" for patch_outline. Valid fields: ${validFields.join(', ')}`, id, 'outline');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, 'outline', id);
  const currentData = getObjectData(object, language);
  const currentValue = (currentData[field] as string) ?? '';

  const result = applySingleReplacement(currentValue, oldText, newText);
  if (!result.success) {
    return error(`[${field}] ${result.error}`, id, 'outline');
  }

  await store.updateObject('outline', id, {
    data: { ...currentData, [field]: result.value },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return ok('Updated outline', { id, field });
}

/**
 * Patch an act field using search and replace
 */
export async function patchOutlineAct(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, field, old: oldText, new: newText, order } = args as {
    id?: string;
    field?: string;
    old?: string;
    new?: string;
    order?: number;
  };

  if (!id || !field || !oldText || newText === undefined) {
    return error('Missing required fields (id, field, old, new) for patch_outline_act');
  }

  const validFields = ['name', 'description'];
  if (!validFields.includes(field)) {
    return error(`Invalid field "${field}" for patch_outline_act. Valid fields: ${validFields.join(', ')}`, id, 'act');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, 'act', id);
  const currentData = getObjectData(object, language);
  const currentValue = (currentData[field] as string) ?? '';

  const result = applySingleReplacement(currentValue, oldText, newText);
  if (!result.success) {
    return error(`[${field}] ${result.error}`, id, 'act');
  }

  // Build metadata for order change
  const metadata: Record<string, unknown> = {};
  if (order !== undefined && typeof order === 'number') {
    metadata.order = order;
  }

  await store.updateObject('act', id, {
    data: { ...currentData, [field]: result.value },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });

  return ok('Updated act', { id, field, ...(order !== undefined && { order }) });
}

/**
 * Patch a chapter field using search and replace
 */
export async function patchOutlineChapter(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, field, old: oldText, new: newText, order, actId } = args as {
    id?: string;
    field?: string;
    old?: string;
    new?: string;
    order?: number;
    actId?: string;
  };

  if (!id || !field || !oldText || newText === undefined) {
    return error('Missing required fields (id, field, old, new) for patch_outline_chapter');
  }

  const validFields = ['name', 'description'];
  if (!validFields.includes(field)) {
    return error(`Invalid field "${field}" for patch_outline_chapter. Valid fields: ${validFields.join(', ')}`, id, 'chapter');
  }

  if (actId !== undefined && (typeof actId !== 'string' || !actId.trim())) {
    return error('Invalid actId for patch_outline_chapter', id, 'chapter');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, 'chapter', id);
  const currentData = getObjectData(object, language);
  const currentValue = (currentData[field] as string) ?? '';

  const result = applySingleReplacement(currentValue, oldText, newText);
  if (!result.success) {
    return error(`[${field}] ${result.error}`, id, 'chapter');
  }

  // Build metadata for order/actId change
  const metadata: Record<string, unknown> = {};
  if (actId) {
    metadata.act_id = actId;
  }
  if (order !== undefined && typeof order === 'number') {
    metadata.order = order;
  }

  await store.updateObject('chapter', id, {
    data: { ...currentData, [field]: result.value },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });

  return ok('Updated chapter', { id, field, ...(actId && { actId }), ...(order !== undefined && { order }) });
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const PATCH_HANDLERS = {
  // Basic handlers
  patch_basic_info: patchBasicInfo,
  patch_story_object: patchStoryObject,
  // Outline handlers
  patch_outline: patchOutline,
  patch_outline_act: patchOutlineAct,
  patch_outline_chapter: patchOutlineChapter,
};

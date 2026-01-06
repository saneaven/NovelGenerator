/**
 * Replace Handlers
 *
 * Handlers for full replacement operations:
 * - replace_basic_info
 * - replace_story_object
 * - replace_manuscript
 * - replace_outline / replace_outline_act / replace_outline_chapter
 */

import type { ApplicationResult } from '../../types';
import { getObjectData, ALL_OBJECT_TYPE_MAP } from '../../types';
import type { HandlerContext } from '../types';
import type { ObjectType, UnifiedObject } from '../../../types/unifiedObject';

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

// ============================================================================
// REPLACE HANDLERS
// ============================================================================

/**
 * Replace basic info fields
 */
export async function replaceBasicInfo(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { title, logline, genre } = args as {
    title?: string;
    logline?: string;
    genre?: string;
  };

  const { store, projectId, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const existing = await store.listObjects('basic_info', projectId);
  if (existing.length === 0) {
    // BasicInfo should be auto-created with the project
    return error('BasicInfo not found. This should not happen.');
  }

  const basic = existing[0];
  const currentData = getObjectData(basic, language);

  await store.updateObject('basic_info', basic.id, {
    data: {
      title: title ?? currentData.title ?? '',
      logline: logline ?? currentData.logline ?? '',
      genre: genre ?? currentData.genre ?? '',
    },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });
  return ok('Updated basic info', { id: basic.id });
}

/**
 * Replace story object fields.
 * Also used for translation via set_object_translation (with ALL_OBJECT_TYPE_MAP).
 */
export async function replaceStoryObject(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type, name, description } = args as {
    id?: string;
    type?: string;
    name?: string;
    description?: string;
  };

  if (!id || !type) {
    return error('Missing id or type for replace_story_object');
  }

  // Use ALL_OBJECT_TYPE_MAP to support both story objects and outline types (for translation)
  const objectType = ALL_OBJECT_TYPE_MAP[type];
  if (!objectType) {
    return error(`Unknown object type: ${type}`);
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, objectType, id);
  const currentData = getObjectData(object, language);

  await store.updateObject(objectType, id, {
    data: {
      name: name ?? currentData.name ?? '',
      description: description ?? currentData.description ?? '',
    },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return ok(`Updated ${type}`, { id, type });
}

/**
 * Replace manuscript content
 */
export async function replaceManuscript(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, content } = args as {
    id?: string;
    content?: string;
  };

  if (!id || content === undefined) {
    return error('Missing id or content for replace_manuscript');
  }

  const { store, projectId, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  // Get manuscript by ID or find by chapter reference
  let manuscript = store.getObject(id) ?? null;

  // If not found, the ID might be a chapter ID (for legacy compatibility during transition)
  if (!manuscript) {
    const manuscripts = await store.listObjects('manuscript', projectId);
    manuscript = manuscripts.find((m: UnifiedObject) => m.metadata?.chapter_id === id) ?? null;
  }

  if (!manuscript) {
    // Create new manuscript if it doesn't exist
    manuscript = await store.createObject(
      'manuscript',
      projectId,
      { content: '', wordCount: 0 },
      language,
      { chapter_id: id },
      userRequest
    );
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  await store.updateObject('manuscript', manuscript.id, {
    data: { content, wordCount },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return ok('Updated manuscript', { id: manuscript.id });
}

// ============================================================================
// OUTLINE REPLACE HANDLERS
// ============================================================================

/**
 * Replace outline fields
 */
export async function replaceOutline(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, name, description } = args as {
    id?: string;
    name?: string;
    description?: string;
  };

  if (!id) {
    return error('Missing id for replace_outline');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, 'outline', id);
  const currentData = getObjectData(object, language);

  await store.updateObject('outline', id, {
    data: {
      name: name ?? currentData.name ?? '',
      description: description ?? currentData.description ?? '',
    },
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
  });

  return ok('Updated outline', { id });
}

/**
 * Replace act fields
 */
export async function replaceOutlineAct(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, name, description, order } = args as {
    id?: string;
    name?: string;
    description?: string;
    order?: number;
  };

  if (!id) {
    return error('Missing id for replace_outline_act');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, 'act', id);
  const currentData = getObjectData(object, language);

  const updateData: Record<string, unknown> = {
    name: name ?? currentData.name ?? '',
    description: description ?? currentData.description ?? '',
  };

  // Build metadata for structural changes (order)
  const metadata: Record<string, unknown> = {};
  if (order !== undefined && typeof order === 'number') {
    metadata.order = order;
  }

  await store.updateObject('act', id, {
    data: updateData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });

  return ok('Updated act', { id });
}

/**
 * Replace chapter fields (outline-prefixed version)
 */
export async function replaceOutlineChapter(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, actId, name, description, order } = args as {
    id?: string;
    actId?: string;
    name?: string;
    description?: string;
    order?: number;
  };

  if (!id) {
    return error('Missing id for replace_outline_chapter');
  }

  const { store, language } = context;
  const { createNewVersion = true, userRequest = 'AI Edit' } = context.options;

  const object = await ensureObject(store, 'chapter', id);
  const currentData = getObjectData(object, language);

  const updateData: Record<string, unknown> = {
    name: name ?? currentData.name ?? '',
    description: description ?? currentData.description ?? '',
  };

  // Build metadata for structural changes (actId, order)
  const metadata: Record<string, unknown> = {};
  if (actId) {
    metadata.act_id = actId;
  }
  if (order !== undefined && typeof order === 'number') {
    metadata.order = order;
  }

  await store.updateObject('chapter', id, {
    data: updateData,
    language,
    create_new_version: createNewVersion,
    user_request: userRequest,
    ...(Object.keys(metadata).length > 0 && { metadata }),
  });

  return ok('Updated chapter', { id });
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const REPLACE_HANDLERS = {
  // Basic handlers
  replace_basic_info: replaceBasicInfo,
  replace_story_object: replaceStoryObject,
  replace_manuscript: replaceManuscript,
  // Outline handlers
  replace_outline: replaceOutline,
  replace_outline_act: replaceOutlineAct,
  replace_outline_chapter: replaceOutlineChapter,
};

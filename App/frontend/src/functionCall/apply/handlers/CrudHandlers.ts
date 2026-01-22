/**
 * Apply Handlers - CRUD
 *
 * Handlers for create and delete operations:
 * - create_story_object / delete_story_object
 * - create_outline / delete_outline
 * - create_outline_act / delete_outline_act
 * - create_outline_chapter / delete_outline_chapter
 */

import type { ApplicationResult, StoryObjectSubtype } from '../../types';
import { STORY_OBJECT_TYPE_MAP } from '../../types';
import type { HandlerContext } from '../types';
import type { UnifiedObject } from '../../../types/unifiedObject';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function ok(message: string, data?: Record<string, unknown>): ApplicationResult {
  return { success: true, message, data };
}

function error(message: string): ApplicationResult {
  return { success: false, message, error: message };
}

// ============================================================================
// CREATE HANDLERS
// ============================================================================

/**
 * Create a story object (character, location, organization, or lorebook)
 */
export async function createStoryObject(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { type, name, description } = args as {
    type?: string;
    name?: string;
    description?: string;
  };

  if (!type || !name || !description) {
    return error('Missing required fields for create_story_object');
  }

  const objectType = STORY_OBJECT_TYPE_MAP[type as StoryObjectSubtype];
  if (!objectType) {
    return error(`Unknown story object type: ${type}`);
  }

  const { store, projectId, language } = context;
  const userRequest = context.options.userRequest ?? 'AI Edit';

  await store.createObject(objectType, projectId, { name, description }, language, undefined, userRequest);
  return ok(`Created ${type}: ${name}`);
}

/**
 * Delete a story object by ID and type
 */
export async function deleteStoryObject(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type } = args as { id?: string; type?: string };

  if (!id || !type) {
    return error('Missing id or type for delete_story_object');
  }

  const objectType = STORY_OBJECT_TYPE_MAP[type as StoryObjectSubtype];
  if (!objectType) {
    return error(`Unknown story object type: ${type}`);
  }

  await context.store.deleteObject(objectType, id);
  return ok(`Deleted ${type}`, { id, type });
}

// ============================================================================
// OUTLINE CRUD HANDLERS
// ============================================================================

/**
 * Create a new outline for the project
 */
export async function createOutline(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { name, description } = args as {
    name?: string;
    description?: string;
  };

  if (!name || !description) {
    return error('Missing required fields for create_outline');
  }

  const { store, projectId, language } = context;
  const userRequest = context.options.userRequest ?? 'AI Edit';

  // Calculate order for new outline
  const outlines = await store.listObjects('outline', projectId);
  const order = outlines.length;

  await store.createObject('outline', projectId, { name, description }, language, { order }, userRequest);
  return ok(`Created outline: ${name}`);
}

/**
 * Delete an outline by ID (and all its acts/chapters)
 */
export async function deleteOutline(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id } = args as { id?: string };

  if (!id) {
    return error('Missing id for delete_outline');
  }

  await context.store.deleteObject('outline', id);
  return ok('Deleted outline', { id });
}

/**
 * Create an act within an outline
 */
export async function createOutlineAct(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { outlineId, name, description } = args as {
    outlineId?: string;
    name?: string;
    description?: string;
  };

  if (!outlineId || !name || !description) {
    return error('Missing required fields for create_outline_act');
  }

  const { store, projectId, language } = context;
  const userRequest = context.options.userRequest ?? 'AI Edit';

  // Calculate order within the outline
  const acts = await store.listObjects('act', projectId);
  const existingInOutline = acts.filter((act: UnifiedObject) => act.metadata?.outline_id === outlineId);
  const order = existingInOutline.length;

  await store.createObject(
    'act',
    projectId,
    { name, description },
    language,
    { outline_id: outlineId, order },
    userRequest
  );

  return ok(`Created act: ${name}`);
}

/**
 * Delete an act by ID (and all its chapters)
 */
export async function deleteOutlineAct(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id } = args as { id?: string };

  if (!id) {
    return error('Missing id for delete_outline_act');
  }

  await context.store.deleteObject('act', id);
  return ok('Deleted act', { id });
}

/**
 * Create a chapter within an act (outline-prefixed version)
 */
export async function createOutlineChapter(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { actId, name, description } = args as {
    actId?: string;
    name?: string;
    description?: string;
  };

  if (!actId || !name || !description) {
    return error('Missing required fields for create_outline_chapter');
  }

  const { store, projectId, language } = context;
  const userRequest = context.options.userRequest ?? 'AI Edit';

  // Calculate order within the act
  const chapters = await store.listObjects('chapter', projectId);
  const existingInAct = chapters.filter((ch: UnifiedObject) => ch.metadata?.act_id === actId);
  const order = existingInAct.length;

  await store.createObject(
    'chapter',
    projectId,
    { name, description },
    language,
    { act_id: actId, order },
    userRequest
  );

  return ok(`Created chapter: ${name}`);
}

/**
 * Delete a chapter by ID (outline-prefixed version)
 */
export async function deleteOutlineChapter(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id } = args as { id?: string };

  if (!id) {
    return error('Missing id for delete_outline_chapter');
  }

  await context.store.deleteObject('chapter', id);
  return ok('Deleted chapter', { id });
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const CRUD_HANDLERS = {
  // Story objects
  create_story_object: createStoryObject,
  delete_story_object: deleteStoryObject,
  // Outline system
  create_outline: createOutline,
  delete_outline: deleteOutline,
  create_outline_act: createOutlineAct,
  delete_outline_act: deleteOutlineAct,
  create_outline_chapter: createOutlineChapter,
  delete_outline_chapter: deleteOutlineChapter,
};

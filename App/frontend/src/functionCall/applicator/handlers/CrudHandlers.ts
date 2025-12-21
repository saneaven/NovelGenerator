/**
 * CRUD Handlers
 *
 * Handlers for create and delete operations:
 * - create_story_object
 * - delete_story_object
 * - create_chapter
 * - delete_chapter
 */

import type { ApplicationResult, StoryObjectSubtype } from '../../types';
import type { HandlerContext } from '../types';
import type { ObjectType, UnifiedObject } from '../../../types/unifiedObject';

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

// ============================================================================
// CREATE HANDLERS
// ============================================================================

/**
 * Create a story object (character, location, organization, lorebook, or act)
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

  // Special handling for acts - need to set order
  if (type === 'act') {
    const acts = await store.listObjects('act', projectId);
    const order = acts.length;
    await store.createObject('act', projectId, { name, description }, language, { order }, 'AI Edit');
    return ok(`Created act: ${name}`);
  }

  await store.createObject(objectType, projectId, { name, description }, language, undefined, 'AI Edit');
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

/**
 * Create a chapter within an act
 */
export async function createChapter(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { actId, name, description } = args as {
    actId?: string;
    name?: string;
    description?: string;
  };

  if (!actId || !name || !description) {
    return error('Missing required fields for create_chapter');
  }

  const { store, projectId, language } = context;

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
    'AI Edit'
  );

  return ok(`Created chapter: ${name}`);
}

/**
 * Delete a chapter by ID
 */
export async function deleteChapter(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id } = args as { id?: string };

  if (!id) {
    return error('Missing id for delete_chapter');
  }

  await context.store.deleteObject('chapter', id);
  return ok('Deleted chapter', { id });
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const CRUD_HANDLERS = {
  create_story_object: createStoryObject,
  delete_story_object: deleteStoryObject,
  create_chapter: createChapter,
  delete_chapter: deleteChapter,
};

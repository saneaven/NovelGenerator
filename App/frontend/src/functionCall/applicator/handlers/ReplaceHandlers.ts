/**
 * Replace Handlers
 *
 * Handlers for full replacement operations:
 * - replace_basic_info
 * - replace_story_object
 * - replace_chapter
 * - replace_manuscript
 */

import type { ApplicationResult, StoryObjectSubtype } from '../../types';
import { getObjectData } from '../../types';
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

  const existing = await store.listObjects('basic_info', projectId);
  if (existing.length > 0) {
    const basic = existing[0];
    const currentData = getObjectData(basic, language);

    await store.updateObject('basic_info', basic.id, {
      data: {
        title: title ?? currentData.title ?? '',
        logline: logline ?? currentData.logline ?? '',
        genre: genre ?? currentData.genre ?? '',
      },
      language,
      create_new_version: true,
      user_request: 'AI Edit',
    });
    return ok('Updated basic info', { id: basic.id });
  }

  // Create new basic info if it doesn't exist
  const created = await store.createObject(
    'basic_info',
    projectId,
    { title: title ?? '', logline: logline ?? '', genre: genre ?? '' },
    language,
    undefined,
    'AI Edit'
  );
  return ok('Created basic info', { id: created.id });
}

/**
 * Replace story object fields
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

  const objectType = STORY_OBJECT_TYPE_MAP[type as StoryObjectSubtype];
  if (!objectType) {
    return error(`Unknown story object type: ${type}`);
  }

  const { store, language } = context;

  const object = await ensureObject(store, objectType, id);
  const currentData = getObjectData(object, language);

  await store.updateObject(objectType, id, {
    data: {
      name: name ?? currentData.name ?? '',
      description: description ?? currentData.description ?? '',
    },
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return ok(`Updated ${type}`, { id, type });
}

/**
 * Replace chapter fields
 */
export async function replaceChapter(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, actId, name, description } = args as {
    id?: string;
    actId?: string;
    name?: string;
    description?: string;
  };

  if (!id) {
    return error('Missing id for replace_chapter');
  }

  const { store, language } = context;

  const object = await ensureObject(store, 'chapter', id);
  const currentData = getObjectData(object, language);

  const updateData: Record<string, unknown> = {
    name: name ?? currentData.name ?? '',
    description: description ?? currentData.description ?? '',
  };

  // Handle actId change if provided
  const metadata = actId ? { act_id: actId } : undefined;

  await store.updateObject('chapter', id, {
    data: updateData,
    language,
    create_new_version: true,
    user_request: 'AI Edit',
    ...(metadata && { metadata }),
  });

  return ok('Updated chapter', { id });
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
      'AI Edit'
    );
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  await store.updateObject('manuscript', manuscript.id, {
    data: { content, wordCount },
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return ok('Updated manuscript', { id: manuscript.id });
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const REPLACE_HANDLERS = {
  replace_basic_info: replaceBasicInfo,
  replace_story_object: replaceStoryObject,
  replace_chapter: replaceChapter,
  replace_manuscript: replaceManuscript,
};

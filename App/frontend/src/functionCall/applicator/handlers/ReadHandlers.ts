/**
 * Read Handlers
 *
 * Handlers for read operations:
 * - read_story_object: Read character, location, organization, lorebook, basic_info, or guidelines
 * - read_outline: Read outline, act, or chapter
 * - read_manuscript: Read manuscript content (with optional offset)
 */

import type { ApplicationResult } from '../../types';
import { getObjectData } from '../../types';
import type { Handler, HandlerContext } from '../types';
import { docToPlainText, normalizeDoc } from '../../../editor/manuscript/doc';

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
// READ HANDLERS
// ============================================================================

/**
 * Read full content of a story object
 */
export async function readStoryObject(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type } = args as { id?: string; type?: string };

  if (!id || !type) {
    return error('Missing id or type for read_story_object');
  }

  const obj = context.store.getObject(id);
  if (!obj) {
    return error(`Object not found: ${id}`);
  }

  const data = getObjectData(obj, context.language);
  let content: string;

  if (type === 'basic_info') {
    content = `Title: ${data.title ?? ''}\nLogline: ${data.logline ?? ''}\nGenre: ${data.genre ?? ''}`;
  } else if (type === 'guidelines') {
    content = (data.authorNote as string) ?? '';
  } else {
    content = `Name: ${data.name ?? ''}\nDescription: ${data.description ?? ''}`;
  }

  return ok(content, { raw: data, objectId: id, objectType: type });
}

/**
 * Read full content of an outline item (outline, act, or chapter)
 */
export async function readOutline(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type } = args as { id?: string; type?: string };

  if (!id) {
    return error('Missing id for read_outline');
  }

  const obj = context.store.getObject(id);
  if (!obj) {
    return error(`Outline item not found: ${id}`);
  }

  const data = getObjectData(obj, context.language);
  const content = `Name: ${data.name ?? ''}\nDescription: ${data.description ?? ''}`;

  return ok(content, { raw: data, objectId: id, objectType: type ?? obj.type });
}

/**
 * Read manuscript content with optional offset
 */
export async function readManuscript(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, offset } = args as {
    id?: string;
    offset?: { from: number; to: number };
  };

  if (!id) {
    return error('Missing id for read_manuscript');
  }

  const manuscript = context.store.getObject(id);
  if (!manuscript) {
    return error(`Manuscript not found: ${id}`);
  }

  const data = getObjectData(manuscript, context.language);
  const doc = normalizeDoc((data as { doc?: unknown }).doc);
  let plainText = docToPlainText(doc);
  const totalLength = plainText.length;

  // Apply offset if provided
  if (offset) {
    plainText = plainText.slice(offset.from, offset.to);
  }

  return ok(plainText, {
    wordCount: (data as { wordCount?: number }).wordCount,
    totalLength,
    offset: offset ?? null,
    objectId: id,
    objectType: 'manuscript',
  });
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const READ_HANDLERS: Record<string, Handler> = {
  read_story_object: readStoryObject,
  read_outline: readOutline,
  read_manuscript: readManuscript,
};

/**
 * Translation Handlers
 *
 * Handlers for translation operations:
 * - set_basic_info_translation
 * - set_object_translation
 * - set_chapter_outline_translation
 * - set_manuscript_translation
 * - patch_basic_info_translation
 * - patch_object_translation
 * - patch_chapter_outline_translation
 * - patch_manuscript_translation
 */

import type { ApplicationResult, PatchRetryContext } from '../../types';
import { getObjectData } from '../../types';
import type { HandlerContext } from '../types';
import type { ObjectType } from '../../../types/unifiedObject';
import type { Replacement } from '../../../types/patchTypes';
import { applyPatch } from '../../../utils/patchUtils';

/** Maps translation object type to unified object type */
const OBJECT_TYPE_MAP: Record<string, ObjectType> = {
  character: 'character',
  organization: 'organization',
  location: 'location',
  lorebook: 'lorebook',
  act: 'act',
  chapter: 'chapter',
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

async function saveTranslation(
  context: HandlerContext,
  objectType: ObjectType,
  objectId: string,
  data: Record<string, unknown>
): Promise<void> {
  const { translationService, targetLanguage } = context;

  if (!translationService) {
    throw new Error('Translation service not available');
  }

  if (!targetLanguage) {
    throw new Error('Target language not specified');
  }

  await translationService.addTranslations([
    { objectType, objectId, language: targetLanguage, data },
  ]);
}

// ============================================================================
// SET HANDLERS
// ============================================================================

/**
 * Set translation for basic info
 */
export async function setBasicInfoTranslation(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, title, logline, genre } = args as {
    id?: string;
    title?: string;
    logline?: string;
    genre?: string;
  };

  if (!id) {
    return error('Missing id for set_basic_info_translation');
  }

  const data = {
    title: title ?? '',
    logline: logline ?? '',
    genre: genre ?? '',
  };

  await saveTranslation(context, 'basic_info', id, data);

  return ok('Basic info translation set successfully', { id, ...data });
}

/**
 * Set translation for story objects
 */
export async function setObjectTranslation(
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
    return error('Missing id or type for set_object_translation');
  }

  const objectType = OBJECT_TYPE_MAP[type];
  if (!objectType) {
    return error(`Unknown type: ${type}`);
  }

  const data = {
    name: name ?? '',
    description: description ?? '',
  };

  await saveTranslation(context, objectType, id, data);

  return ok(`${type} translation set successfully`, { id, type, ...data });
}

/**
 * Set translation for acts/chapters
 */
export async function setChapterOutlineTranslation(
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
    return error('Missing id or type for set_chapter_outline_translation');
  }

  const objectType = type === 'act' ? 'act' : 'chapter';

  const data = {
    name: name ?? '',
    description: description ?? '',
  };

  await saveTranslation(context, objectType, id, data);

  return ok(`${type} translation set successfully`, { id, type, ...data });
}

/**
 * Set translation for manuscript
 */
export async function setManuscriptTranslation(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, content } = args as {
    id?: string;
    content?: string;
  };

  if (!id) {
    return error('Missing id for set_manuscript_translation');
  }

  const contentStr = content ?? '';
  const wordCount = contentStr.trim().split(/\s+/).filter(Boolean).length;

  const data = {
    content: contentStr,
    wordCount,
  };

  await saveTranslation(context, 'manuscript', id, data);

  return ok('Manuscript translation set successfully', { id, wordCount });
}

// ============================================================================
// PATCH HANDLERS
// ============================================================================

/**
 * Patch basic info translation with search-replace
 */
export async function patchBasicInfoTranslation(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, replacements } = args as {
    id?: string;
    replacements?: Replacement[];
  };

  if (!id || !replacements || !Array.isArray(replacements)) {
    return error('Missing id or replacements for patch_basic_info_translation');
  }

  const { store, targetLanguage } = context;

  if (!targetLanguage) {
    return error('Target language not specified');
  }

  const object = store.getObject(id);
  if (!object) {
    return error(`Object with id ${id} not found`);
  }

  const currentData = getObjectData(object, targetLanguage);
  const retryContexts: PatchRetryContext[] = [];

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
        objectId: id,
        fieldName: r.field,
        currentValue: newData[r.field],
        error: result.error || 'Patch failed',
      });
    }
  }

  await saveTranslation(context, 'basic_info', id, newData);

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? 'Basic info translation patched successfully'
      : `Basic info translation patched with ${retryContexts.length} failure(s)`,
    objectId: id,
    objectType: 'basic_info',
    data: newData,
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

/**
 * Patch object translation with search-replace
 */
export async function patchObjectTranslation(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type, replacements } = args as {
    id?: string;
    type?: string;
    replacements?: Replacement[];
  };

  if (!id || !type || !replacements) {
    return error('Missing required fields for patch_object_translation');
  }

  const objectType = OBJECT_TYPE_MAP[type];
  if (!objectType) {
    return error(`Unknown type: ${type}`);
  }

  const { store, targetLanguage } = context;

  if (!targetLanguage) {
    return error('Target language not specified');
  }

  const object = store.getObject(id);
  if (!object) {
    return error(`Object with id ${id} not found`);
  }

  const currentData = getObjectData(object, targetLanguage);
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

  await saveTranslation(context, objectType, id, newData);

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? `${type} translation patched successfully`
      : `${type} translation patched with ${retryContexts.length} failure(s)`,
    objectId: id,
    objectType: type,
    data: newData,
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

/**
 * Patch chapter/act translation with search-replace
 */
export async function patchChapterOutlineTranslation(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, type, replacements } = args as {
    id?: string;
    type?: string;
    replacements?: Replacement[];
  };

  if (!id || !type || !replacements) {
    return error('Missing required fields for patch_chapter_outline_translation');
  }

  const objectType = type === 'act' ? 'act' : 'chapter';

  const { store, targetLanguage } = context;

  if (!targetLanguage) {
    return error('Target language not specified');
  }

  const object = store.getObject(id);
  if (!object) {
    return error(`Object with id ${id} not found`);
  }

  const currentData = getObjectData(object, targetLanguage);
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

  await saveTranslation(context, objectType, id, newData);

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? `${type} translation patched successfully`
      : `${type} translation patched with ${retryContexts.length} failure(s)`,
    objectId: id,
    objectType: type,
    data: newData,
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

/**
 * Patch manuscript translation with search-replace
 */
export async function patchManuscriptTranslation(
  args: Record<string, unknown>,
  context: HandlerContext
): Promise<ApplicationResult> {
  const { id, replacements } = args as {
    id?: string;
    replacements?: Array<{ old: string; new: string }>;
  };

  if (!id || !replacements) {
    return error('Missing required fields for patch_manuscript_translation');
  }

  const { store, targetLanguage } = context;

  if (!targetLanguage) {
    return error('Target language not specified');
  }

  const object = store.getObject(id);
  if (!object) {
    return error(`Manuscript with id ${id} not found`);
  }

  const currentData = getObjectData(object, targetLanguage);
  const currentContent = (currentData.content as string) ?? '';
  const retryContexts: PatchRetryContext[] = [];

  const result = applyPatch(currentContent, replacements);

  if (!result.success) {
    retryContexts.push({
      objectId: id,
      fieldName: 'content',
      currentValue: currentContent,
      error: result.error || 'Patch failed',
    });
  }

  const wordCount = result.value.trim().split(/\s+/).filter(Boolean).length;

  await saveTranslation(context, 'manuscript', id, { content: result.value, wordCount });

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? 'Manuscript translation patched successfully'
      : 'Manuscript translation patched with failure(s)',
    objectId: id,
    objectType: 'manuscript',
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

// ============================================================================
// HANDLER REGISTRY
// ============================================================================

export const TRANSLATION_HANDLERS = {
  set_basic_info_translation: setBasicInfoTranslation,
  set_object_translation: setObjectTranslation,
  set_chapter_outline_translation: setChapterOutlineTranslation,
  set_manuscript_translation: setManuscriptTranslation,
  patch_basic_info_translation: patchBasicInfoTranslation,
  patch_object_translation: patchObjectTranslation,
  patch_chapter_outline_translation: patchChapterOutlineTranslation,
  patch_manuscript_translation: patchManuscriptTranslation,
};

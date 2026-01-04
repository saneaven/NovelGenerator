/**
 * Handler exports
 */

export { CRUD_HANDLERS } from './CrudHandlers';
export { REPLACE_HANDLERS } from './ReplaceHandlers';
export { PATCH_HANDLERS } from './PatchHandlers';

import type { Handler } from '../types';
import { TRANSLATION_OPTIONS } from '../types';
import { CRUD_HANDLERS } from './CrudHandlers';
import { REPLACE_HANDLERS } from './ReplaceHandlers';
import { PATCH_HANDLERS } from './PatchHandlers';

// Import handlers that support both CRUD and Translation
import {
  replaceBasicInfo,
  replaceStoryObject,
  replaceManuscript,
  replaceOutlineAct,
  replaceOutlineChapter,
} from './ReplaceHandlers';
import {
  patchBasicInfo,
  patchStoryObject,
  patchManuscript,
  patchOutlineAct,
  patchOutlineChapter,
} from './PatchHandlers';

// ============================================================================
// TRANSLATION HANDLER WRAPPERS
// ============================================================================

/**
 * Translation handlers are wrappers around CRUD handlers with translation options.
 * They use create_new_version: false and user_request: 'AI Translation'.
 */

// Set (replace) translation handlers
const setBasicInfoTranslation: Handler = (args, ctx) =>
  replaceBasicInfo(args, ctx, TRANSLATION_OPTIONS);

const setObjectTranslation: Handler = (args, ctx) =>
  replaceStoryObject(args, ctx, TRANSLATION_OPTIONS);

const setChapterOutlineTranslation: Handler = async (args, ctx) => {
  // This handler supports both 'act' and 'chapter' types in a single function
  const type = args.type as string;
  if (type === 'act') {
    return replaceOutlineAct(args, ctx, TRANSLATION_OPTIONS);
  }
  return replaceOutlineChapter(args, ctx, TRANSLATION_OPTIONS);
};

const setManuscriptTranslation: Handler = (args, ctx) =>
  replaceManuscript(args, ctx, TRANSLATION_OPTIONS);

// Patch translation handlers
const patchBasicInfoTranslation: Handler = (args, ctx) =>
  patchBasicInfo(args, ctx, TRANSLATION_OPTIONS);

const patchObjectTranslation: Handler = (args, ctx) =>
  patchStoryObject(args, ctx, TRANSLATION_OPTIONS);

const patchChapterOutlineTranslation: Handler = async (args, ctx) => {
  const type = args.type as string;
  if (type === 'act') {
    return patchOutlineAct(args, ctx, TRANSLATION_OPTIONS);
  }
  return patchOutlineChapter(args, ctx, TRANSLATION_OPTIONS);
};

const patchManuscriptTranslation: Handler = (args, ctx) =>
  patchManuscript(args, ctx, TRANSLATION_OPTIONS);

// Translation handler registry
const TRANSLATION_HANDLERS: Record<string, Handler> = {
  set_basic_info_translation: setBasicInfoTranslation,
  set_object_translation: setObjectTranslation,
  set_chapter_outline_translation: setChapterOutlineTranslation,
  set_manuscript_translation: setManuscriptTranslation,
  patch_basic_info_translation: patchBasicInfoTranslation,
  patch_object_translation: patchObjectTranslation,
  patch_chapter_outline_translation: patchChapterOutlineTranslation,
  patch_manuscript_translation: patchManuscriptTranslation,
};

/**
 * All handlers combined into a single registry
 */
export const ALL_HANDLERS: Record<string, Handler> = {
  ...CRUD_HANDLERS,
  ...REPLACE_HANDLERS,
  ...PATCH_HANDLERS,
  ...TRANSLATION_HANDLERS,
};

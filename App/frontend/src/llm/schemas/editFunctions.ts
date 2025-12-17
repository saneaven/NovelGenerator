/**
 * Function schemas for AI Edit operations.
 *
 * Uses the same replace/patch pattern as chat functions:
 * - replace_*: Full field replacement
 * - patch_*: Search and replace within fields
 *
 * Categories:
 * - Basic Info: title, logline, genre
 * - Story Object: character, location, organization, lorebook, act
 * - Chapter: id, actId, name, description
 * - Manuscript: chapterId, content
 */

import type { FunctionCallSchema } from './chatFunctions';
import {
  CREATE_STORY_OBJECT_FUNCTION,
  DELETE_STORY_OBJECT_FUNCTION,
  CREATE_CHAPTER_FUNCTION,
  DELETE_CHAPTER_FUNCTION,
} from './chatFunctions';
import type { StoryObjectType } from '../../types/patchTypes';

// ============================================
// SCHEMA BUILDING BLOCKS
// ============================================

/** Story object type enum for schemas */
const STORY_OBJECT_TYPE_ENUM: StoryObjectType[] = [
  'character',
  'location',
  'organization',
  'lorebook',
  'act',
];

/** Schema for story object type field */
const storyObjectTypeSchema = {
  type: 'string',
  enum: STORY_OBJECT_TYPE_ENUM,
  description: 'Type of story object',
};

/** Schema for a single replacement in patch operations (with field) */
const replacementWithFieldSchema = {
  type: 'object',
  properties: {
    field: {
      type: 'string',
      enum: ['name', 'description'],
      description: 'Field to patch',
    },
    old: {
      type: 'string',
      description:
        'Text to find. Include surrounding context to ensure uniqueness.',
    },
    new: {
      type: 'string',
      description: 'Replacement text',
    },
  },
  required: ['field', 'old', 'new'],
};

/** Schema for basic info field replacement */
const basicInfoReplacementSchema = {
  type: 'object',
  properties: {
    field: {
      type: 'string',
      enum: ['title', 'logline', 'genre'],
      description: 'Field to patch',
    },
    old: {
      type: 'string',
      description:
        'Text to find. Include surrounding context to ensure uniqueness.',
    },
    new: {
      type: 'string',
      description: 'Replacement text',
    },
  },
  required: ['field', 'old', 'new'],
};

/** Schema for manuscript replacement (no field, just old/new) */
const manuscriptReplacementSchema = {
  type: 'object',
  properties: {
    old: {
      type: 'string',
      description:
        'Text to find. Include surrounding context to ensure uniqueness.',
    },
    new: {
      type: 'string',
      description: 'Replacement text',
    },
  },
  required: ['old', 'new'],
};

// ============================================
// SINGLE ITEM FUNCTIONS
// ============================================

// ----- Basic Info -----

export const REPLACE_BASIC_INFO_FUNCTION: FunctionCallSchema = {
  name: 'replace_basic_info',
  description:
    'Replace project basic info fields. Only include fields you want to change.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'New project title' },
      logline: { type: 'string', description: 'New project logline' },
      genre: { type: 'string', description: 'New project genre' },
    },
    required: [],
  },
};

export const PATCH_BASIC_INFO_FUNCTION: FunctionCallSchema = {
  name: 'patch_basic_info',
  description:
    'Patch basic info fields using search and replace. Each replacement finds text and replaces it.',
  parameters: {
    type: 'object',
    properties: {
      replacements: {
        type: 'array',
        items: basicInfoReplacementSchema,
        description: 'List of replacements to apply',
      },
    },
    required: ['replacements'],
  },
};

// ----- Story Object -----

export const REPLACE_STORY_OBJECT_FUNCTION: FunctionCallSchema = {
  name: 'replace_story_object',
  description:
    'Replace story object fields. Only include fields you want to change.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the object' },
      type: storyObjectTypeSchema,
      name: { type: 'string', description: 'New name' },
      description: { type: 'string', description: 'New description' },
    },
    required: ['id', 'type'],
  },
};

export const PATCH_STORY_OBJECT_FUNCTION: FunctionCallSchema = {
  name: 'patch_story_object',
  description:
    'Patch story object fields using search and replace. Include enough context in "old" to ensure uniqueness.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the object' },
      type: storyObjectTypeSchema,
      replacements: {
        type: 'array',
        items: replacementWithFieldSchema,
        description: 'List of replacements to apply',
      },
    },
    required: ['id', 'type', 'replacements'],
  },
};

// ----- Chapter -----

export const REPLACE_CHAPTER_FUNCTION: FunctionCallSchema = {
  name: 'replace_chapter',
  description:
    'Replace chapter fields. Only include fields you want to change.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the chapter' },
      actId: { type: 'string', description: 'New parent act ID' },
      name: { type: 'string', description: 'New chapter name' },
      description: { type: 'string', description: 'New chapter description' },
    },
    required: ['id'],
  },
};

export const PATCH_CHAPTER_FUNCTION: FunctionCallSchema = {
  name: 'patch_chapter',
  description:
    'Patch chapter fields using search and replace. Include enough context in "old" to ensure uniqueness.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the chapter' },
      replacements: {
        type: 'array',
        items: replacementWithFieldSchema,
        description: 'List of replacements to apply',
      },
    },
    required: ['id', 'replacements'],
  },
};

// ----- Manuscript -----

export const REPLACE_MANUSCRIPT_FUNCTION: FunctionCallSchema = {
  name: 'replace_manuscript',
  description: 'Replace the entire manuscript content of a chapter.',
  parameters: {
    type: 'object',
    properties: {
      chapterId: { type: 'string', description: 'ID of the chapter' },
      content: {
        type: 'string',
        description: 'Complete new manuscript content',
      },
    },
    required: ['chapterId', 'content'],
  },
};

export const PATCH_MANUSCRIPT_FUNCTION: FunctionCallSchema = {
  name: 'patch_manuscript',
  description:
    'Patch manuscript content using search and replace. Include enough context in "old" to ensure uniqueness.',
  parameters: {
    type: 'object',
    properties: {
      chapterId: { type: 'string', description: 'ID of the chapter' },
      replacements: {
        type: 'array',
        items: manuscriptReplacementSchema,
        description: 'List of replacements to apply',
      },
    },
    required: ['chapterId', 'replacements'],
  },
};


// ============================================
// FUNCTION GROUPS
// ============================================

/** Story object edit functions - excludes manuscript */
export const STORY_OBJECT_EDIT_FUNCTIONS: FunctionCallSchema[] = [
  // CRUD
  CREATE_STORY_OBJECT_FUNCTION,
  DELETE_STORY_OBJECT_FUNCTION,
  CREATE_CHAPTER_FUNCTION,
  DELETE_CHAPTER_FUNCTION,
  // Replace
  REPLACE_BASIC_INFO_FUNCTION,
  REPLACE_STORY_OBJECT_FUNCTION,
  REPLACE_CHAPTER_FUNCTION,
  // Patch
  PATCH_BASIC_INFO_FUNCTION,
  PATCH_STORY_OBJECT_FUNCTION,
  PATCH_CHAPTER_FUNCTION,
];

/** Manuscript edit functions */
export const MANUSCRIPT_EDIT_FUNCTIONS: FunctionCallSchema[] = [
  REPLACE_MANUSCRIPT_FUNCTION,
  PATCH_MANUSCRIPT_FUNCTION,
];



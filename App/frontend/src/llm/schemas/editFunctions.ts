/**
 * Function schemas for AI Edit operations.
 *
 * Uses the same replace/patch pattern as chat functions:
 * - replace_*: Full field replacement
 * - patch_*: Search and replace within fields
 *
 * Categories:
 * - Basic Info: title, logline, genre
 * - Story Object: character, location, item, event, act, other
 * - Chapter: id, actId, name, description
 * - Manuscript: chapterId, content
 */

import type { FunctionCallSchema } from './chatFunctions';
import type { StoryObjectType } from '../../types/patchTypes';

// ============================================
// SCHEMA BUILDING BLOCKS
// ============================================

/** Story object type enum for schemas */
const STORY_OBJECT_TYPE_ENUM: StoryObjectType[] = [
  'character',
  'location',
  'item',
  'event',
  'act',
  'other',
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
// BATCH FUNCTIONS (for editing multiple items)
// ============================================

/** Schema for a single story object in batch operations */
const storyObjectBatchItemSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'ID of the object. Use empty string "" to create new.',
    },
    type: storyObjectTypeSchema,
    name: { type: 'string', description: 'Name' },
    description: { type: 'string', description: 'Description' },
  },
  required: ['id', 'type'],
};

/** Schema for a single chapter in batch operations */
const chapterBatchItemSchema = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'ID of the chapter. Use empty string "" to create new.',
    },
    actId: { type: 'string', description: 'Parent act ID' },
    name: { type: 'string', description: 'Chapter name' },
    description: { type: 'string', description: 'Chapter description' },
  },
  required: ['id'],
};

export const REPLACE_STORY_OBJECTS_BATCH_FUNCTION: FunctionCallSchema = {
  name: 'replace_story_objects_batch',
  description:
    'Replace multiple story objects at once. Can modify existing or create new ones.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Array of story objects to replace or create',
        items: storyObjectBatchItemSchema,
      },
    },
    required: ['items'],
  },
};

export const REPLACE_CHAPTERS_BATCH_FUNCTION: FunctionCallSchema = {
  name: 'replace_chapters_batch',
  description:
    'Replace multiple chapters at once. Can modify existing or create new ones.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: 'Array of chapters to replace or create',
        items: chapterBatchItemSchema,
      },
    },
    required: ['items'],
  },
};

// ============================================
// CHAPTER CONTENT EDIT FUNCTIONS
// ============================================

export const CHAPTER_EDIT_FUNCTIONS: FunctionCallSchema[] = [
  REPLACE_MANUSCRIPT_FUNCTION,
  PATCH_MANUSCRIPT_FUNCTION,
];

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Get the appropriate function schemas based on category and edit scope.
 * Returns both replace and patch functions.
 */
export function getEditFunctionSchemas(
  category: string,
  isSingleItem: boolean
): FunctionCallSchema[] {
  if (isSingleItem) {
    switch (category) {
      case 'basicInfo':
        return [REPLACE_BASIC_INFO_FUNCTION, PATCH_BASIC_INFO_FUNCTION];
      case 'character':
      case 'location':
      case 'item':
      case 'event':
      case 'act':
      case 'other':
      case 'storyObject':
        return [REPLACE_STORY_OBJECT_FUNCTION, PATCH_STORY_OBJECT_FUNCTION];
      case 'chapter':
        return [REPLACE_CHAPTER_FUNCTION, PATCH_CHAPTER_FUNCTION];
      case 'manuscript':
        return [REPLACE_MANUSCRIPT_FUNCTION, PATCH_MANUSCRIPT_FUNCTION];
      default:
        throw new Error(`Unknown category: ${category}`);
    }
  } else {
    // Batch editing
    switch (category) {
      case 'basicInfo':
        return [REPLACE_BASIC_INFO_FUNCTION, PATCH_BASIC_INFO_FUNCTION];
      case 'character':
      case 'location':
      case 'item':
      case 'event':
      case 'act':
      case 'other':
      case 'storyObject':
        return [REPLACE_STORY_OBJECTS_BATCH_FUNCTION];
      case 'chapter':
        return [REPLACE_CHAPTERS_BATCH_FUNCTION];
      default:
        throw new Error(`Unknown category: ${category}`);
    }
  }
}

/**
 * Get edit functions for a specific category.
 * Returns single or batch function based on whether targetId is provided.
 */
export function getEditFunctionsForCategory(
  category: string,
  targetId?: string
): FunctionCallSchema[] {
  const isSingleItem = !!targetId;
  return getEditFunctionSchemas(category, isSingleItem);
}

/**
 * Get all edit function schemas as an array.
 */
export function getAllEditFunctionSchemas(): FunctionCallSchema[] {
  return [
    REPLACE_BASIC_INFO_FUNCTION,
    PATCH_BASIC_INFO_FUNCTION,
    REPLACE_STORY_OBJECT_FUNCTION,
    PATCH_STORY_OBJECT_FUNCTION,
    REPLACE_CHAPTER_FUNCTION,
    PATCH_CHAPTER_FUNCTION,
    REPLACE_MANUSCRIPT_FUNCTION,
    PATCH_MANUSCRIPT_FUNCTION,
    REPLACE_STORY_OBJECTS_BATCH_FUNCTION,
    REPLACE_CHAPTERS_BATCH_FUNCTION,
  ];
}

// ============================================
// LEGACY COMPATIBILITY
// ============================================

// These exports maintain compatibility with existing code that uses the old names.
// TODO: Remove these after updating all consumers.

/** @deprecated Use REPLACE_BASIC_INFO_FUNCTION or PATCH_BASIC_INFO_FUNCTION */
export const EDIT_BASIC_INFO_FUNCTION = REPLACE_BASIC_INFO_FUNCTION;

/** @deprecated Use getEditFunctionSchemas */
export function getEditFunctionSchema(
  category: string,
  isSingleItem: boolean
): FunctionCallSchema {
  const schemas = getEditFunctionSchemas(category, isSingleItem);
  return schemas[0]; // Return first schema for backward compatibility
}

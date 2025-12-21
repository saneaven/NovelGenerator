/**
 * Chat Function Schemas for Workspace and Novel Editing
 *
 * Gemini-compatible function schemas using simple JSON Schema subset.
 * No `oneOf`, `anyOf`, `allOf` - only type/properties/required.
 *
 * Function Categories:
 * - CRUD: create_story_object, delete_story_object, create_chapter, delete_chapter
 * - Replace: replace_basic_info, replace_story_object, replace_chapter, replace_manuscript
 * - Patch: patch_basic_info, patch_story_object, patch_chapter, patch_manuscript
 */

import type { StoryObjectType } from '../../types/patchTypes';

// ============================================
// TYPES
// ============================================

export interface FunctionCallSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export interface FunctionCall {
  name: string;
  arguments: string; // JSON string
}

export interface FunctionCallResult {
  success: boolean;
  message: string;
  error?: string;
  data?: unknown;
}

export interface FunctionCallMessage {
  id: string;
  role: 'assistant';
  content: string | null;
  function_call?: FunctionCall;
  timestamp: Date;
}

export interface FunctionResultMessage {
  id: string;
  role: 'function';
  name: string;
  content: string;
  timestamp: Date;
}

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

/** Schema for a single replacement in patch operations */
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
// CRUD FUNCTIONS (exported individually)
// ============================================

export const CREATE_STORY_OBJECT_FUNCTION: FunctionCallSchema = {
  name: 'create_story_object',
  description:
    'Create a story object (character, location, organization, lorebook, or act).',
  parameters: {
    type: 'object',
    properties: {
      type: storyObjectTypeSchema,
      name: { type: 'string', description: 'Name of the object' },
      description: {
        type: 'string',
        description: 'Description of the object',
      },
    },
    required: ['type', 'name', 'description'],
  },
};

export const DELETE_STORY_OBJECT_FUNCTION: FunctionCallSchema = {
  name: 'delete_story_object',
  description: 'Delete a story object by ID and type.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the object to delete' },
      type: storyObjectTypeSchema,
    },
    required: ['id', 'type'],
  },
};

export const CREATE_CHAPTER_FUNCTION: FunctionCallSchema = {
  name: 'create_chapter',
  description: 'Create a chapter within an act.',
  parameters: {
    type: 'object',
    properties: {
      actId: { type: 'string', description: 'ID of the parent act' },
      name: { type: 'string', description: 'Chapter name' },
      description: { type: 'string', description: 'Chapter description' },
    },
    required: ['actId', 'name', 'description'],
  },
};

export const DELETE_CHAPTER_FUNCTION: FunctionCallSchema = {
  name: 'delete_chapter',
  description: 'Delete a chapter by ID.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the chapter to delete' },
    },
    required: ['id'],
  },
};

// ============================================
// WORKSPACE FUNCTIONS
// ============================================

export const WORKSPACE_FUNCTIONS: FunctionCallSchema[] = [
  // CRUD
  CREATE_STORY_OBJECT_FUNCTION,
  DELETE_STORY_OBJECT_FUNCTION,
  CREATE_CHAPTER_FUNCTION,
  DELETE_CHAPTER_FUNCTION,

  // ----------------------------------------
  // Replace: Full field replacement
  // ----------------------------------------
  {
    name: 'replace_basic_info',
    description:
      "Replace project basic info fields. Only include fields you want to change.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'New project title' },
        logline: { type: 'string', description: 'New project logline' },
        genre: { type: 'string', description: 'New project genre' },
      },
      required: [],
    },
  },
  {
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
  },
  {
    name: 'replace_chapter',
    description:
      'Replace chapter fields. Only include fields you want to change.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the manuscript' },
        actId: { type: 'string', description: 'New parent act ID' },
        name: { type: 'string', description: 'New chapter name' },
        description: { type: 'string', description: 'New chapter description' },
      },
      required: ['id'],
    },
  },
  {
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
  },

  // ----------------------------------------
  // Patch: Search and replace within fields
  // ----------------------------------------
  {
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
  },
  {
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
  },
  {
    name: 'patch_chapter',
    description:
      'Patch chapter fields using search and replace. Include enough context in "old" to ensure uniqueness.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the manuscript' },
        replacements: {
          type: 'array',
          items: replacementWithFieldSchema,
          description: 'List of replacements to apply',
        },
      },
      required: ['id', 'replacements'],
    },
  },
  {
    name: 'patch_manuscript',
    description:
      'Patch manuscript content using search and replace. Include enough context in "old" to ensure uniqueness.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the manuscript' },
        replacements: {
          type: 'array',
          items: manuscriptReplacementSchema,
          description: 'List of replacements to apply',
        },
      },
      required: ['id', 'replacements'],
    },
  },
];

// ============================================
// NOVEL EDITOR FUNCTIONS
// ============================================

/**
 * Novel editor functions for manuscript editing.
 * Uses the same replace/patch pattern as workspace functions.
 */
export const NOVEL_EDITOR_FUNCTIONS: FunctionCallSchema[] = [
  {
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
  },
  {
    name: 'patch_manuscript',
    description:
      'Patch manuscript content using search and replace. Include enough context in "old" to ensure uniqueness.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID of the manuscript' },
        replacements: {
          type: 'array',
          items: manuscriptReplacementSchema,
          description: 'List of replacements to apply',
        },
      },
      required: ['id', 'replacements'],
    },
  },
];

// ============================================
// FUNCTION NAME LISTS (for validation)
// ============================================

export const WORKSPACE_FUNCTION_NAMES = WORKSPACE_FUNCTIONS.map((f) => f.name);
export const NOVEL_EDITOR_FUNCTION_NAMES = NOVEL_EDITOR_FUNCTIONS.map(
  (f) => f.name
);

/** All function names that perform create operations */
export const CREATE_FUNCTION_NAMES = [
  'create_story_object',
  'create_chapter',
] as const;

/** All function names that perform delete operations */
export const DELETE_FUNCTION_NAMES = [
  'delete_story_object',
  'delete_chapter',
] as const;

/** All function names that perform replace operations */
export const REPLACE_FUNCTION_NAMES = [
  'replace_basic_info',
  'replace_story_object',
  'replace_chapter',
  'replace_manuscript',
] as const;


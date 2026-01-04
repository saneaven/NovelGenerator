/**
 * Translation Function Schemas
 *
 * Functions for translating story content between languages.
 * - Set functions: Full translation (new or replace existing)
 * - Patch functions: Search-replace edits for minor corrections
 */

import type { FunctionCallSchema } from '../../functionCall';

// ============================================================================
// SET FUNCTIONS - Full translation (new or replace existing)
// ============================================================================

export const SET_BASIC_INFO_TRANSLATION: FunctionCallSchema = {
  name: 'set_basic_info_translation',
  description: 'Set translation for project basic info.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the basic info object' },
      title: { type: 'string', description: 'Translated title' },
      logline: { type: 'string', description: 'Translated logline' },
      genre: { type: 'string', description: 'Translated genre' },
    },
    required: ['id', 'title', 'logline', 'genre'],
  },
};

export const SET_OBJECT_TRANSLATION: FunctionCallSchema = {
  name: 'set_object_translation',
  description: 'Set translation for story objects (character, organization, location, lorebook).',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the object' },
      type: {
        type: 'string',
        enum: ['character', 'organization', 'location', 'lorebook'],
        description: 'Type of the object',
      },
      name: { type: 'string', description: 'Translated name' },
      description: { type: 'string', description: 'Translated description' },
    },
    required: ['id', 'type', 'name', 'description'],
  },
};

export const SET_CHAPTER_OUTLINE_TRANSLATION: FunctionCallSchema = {
  name: 'set_chapter_outline_translation',
  description: 'Set translation for acts or chapters.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the act or chapter' },
      type: {
        type: 'string',
        enum: ['act', 'chapter'],
        description: 'Type: act or chapter',
      },
      name: { type: 'string', description: 'Translated name' },
      description: { type: 'string', description: 'Translated description' },
    },
    required: ['id', 'type', 'name', 'description'],
  },
};

export const SET_MANUSCRIPT_TRANSLATION: FunctionCallSchema = {
  name: 'set_manuscript_translation',
  description: 'Set translation for manuscript content.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the manuscript' },
      content: { type: 'string', description: 'Translated manuscript content' },
    },
    required: ['id', 'content'],
  },
};

// ============================================================================
// PATCH FUNCTIONS - Search-replace edits
// ============================================================================

export const PATCH_BASIC_INFO_TRANSLATION: FunctionCallSchema = {
  name: 'patch_basic_info_translation',
  description: 'Patch basic info translation with search-replace.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the basic info object' },
      replacements: {
        type: 'array',
        description: 'List of search-replace operations',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              enum: ['title', 'logline', 'genre'],
              description: 'Field to patch',
            },
            old: { type: 'string', description: 'Text to find' },
            new: { type: 'string', description: 'Replacement text' },
          },
          required: ['field', 'old', 'new'],
        },
      },
    },
    required: ['id', 'replacements'],
  },
};

export const PATCH_OBJECT_TRANSLATION: FunctionCallSchema = {
  name: 'patch_object_translation',
  description: 'Patch object translation with search-replace.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the object' },
      type: {
        type: 'string',
        enum: ['character', 'organization', 'location', 'lorebook'],
        description: 'Type of the object',
      },
      replacements: {
        type: 'array',
        description: 'List of search-replace operations',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              enum: ['name', 'description'],
              description: 'Field to patch',
            },
            old: { type: 'string', description: 'Text to find' },
            new: { type: 'string', description: 'Replacement text' },
          },
          required: ['field', 'old', 'new'],
        },
      },
    },
    required: ['id', 'type', 'replacements'],
  },
};

export const PATCH_CHAPTER_OUTLINE_TRANSLATION: FunctionCallSchema = {
  name: 'patch_chapter_outline_translation',
  description: 'Patch act/chapter translation with search-replace.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the act or chapter' },
      type: {
        type: 'string',
        enum: ['act', 'chapter'],
        description: 'Type: act or chapter',
      },
      replacements: {
        type: 'array',
        description: 'List of search-replace operations',
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              enum: ['name', 'description'],
              description: 'Field to patch',
            },
            old: { type: 'string', description: 'Text to find' },
            new: { type: 'string', description: 'Replacement text' },
          },
          required: ['field', 'old', 'new'],
        },
      },
    },
    required: ['id', 'type', 'replacements'],
  },
};

export const PATCH_MANUSCRIPT_TRANSLATION: FunctionCallSchema = {
  name: 'patch_manuscript_translation',
  description: 'Patch manuscript translation with search-replace.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the manuscript' },
      replacements: {
        type: 'array',
        description: 'List of search-replace operations',
        items: {
          type: 'object',
          properties: {
            old: { type: 'string', description: 'Text to find' },
            new: { type: 'string', description: 'Replacement text' },
          },
          required: ['old', 'new'],
        },
      },
    },
    required: ['id', 'replacements'],
  },
};

// ============================================================================
// AGENT MESSAGE TRANSLATION
// ============================================================================

export const SET_AGENT_MESSAGE_TRANSLATION: FunctionCallSchema = {
  name: 'set_agent_message_translation',
  description: 'Translate an agent message from one language to another.',
  parameters: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'Translated message content',
      },
    },
    required: ['content'],
  },
};

// ============================================================================
// FUNCTION GROUPS
// ============================================================================

export const SET_TRANSLATION_FUNCTIONS: FunctionCallSchema[] = [
  SET_BASIC_INFO_TRANSLATION,
  SET_OBJECT_TRANSLATION,
  SET_CHAPTER_OUTLINE_TRANSLATION,
  SET_MANUSCRIPT_TRANSLATION,
];

export const PATCH_TRANSLATION_FUNCTIONS: FunctionCallSchema[] = [
  PATCH_BASIC_INFO_TRANSLATION,
  PATCH_OBJECT_TRANSLATION,
  PATCH_CHAPTER_OUTLINE_TRANSLATION,
  PATCH_MANUSCRIPT_TRANSLATION,
];

export const TRANSLATION_FUNCTIONS: FunctionCallSchema[] = [
  ...SET_TRANSLATION_FUNCTIONS,
  ...PATCH_TRANSLATION_FUNCTIONS,
];

export const AGENT_TRANSLATION_FUNCTIONS: FunctionCallSchema[] = [
  SET_AGENT_MESSAGE_TRANSLATION,
];

// ============================================================================
// FUNCTION NAME SETS
// ============================================================================

export const SET_FUNCTION_NAMES = new Set([
  'set_basic_info_translation',
  'set_object_translation',
  'set_chapter_outline_translation',
  'set_manuscript_translation',
]);

export const PATCH_FUNCTION_NAMES = new Set([
  'patch_basic_info_translation',
  'patch_object_translation',
  'patch_chapter_outline_translation',
  'patch_manuscript_translation',
]);

export const ALL_TRANSLATION_FUNCTION_NAMES = new Set([
  ...SET_FUNCTION_NAMES,
  ...PATCH_FUNCTION_NAMES,
]);

// ============================================================================
// TYPE MAPPING
// ============================================================================

export const FUNCTION_TO_OBJECT_TYPE: Record<string, string> = {
  set_basic_info_translation: 'basic_info',
  set_object_translation: 'object',
  set_chapter_outline_translation: 'chapter',
  set_manuscript_translation: 'manuscript',
  patch_basic_info_translation: 'basic_info',
  patch_object_translation: 'object',
  patch_chapter_outline_translation: 'chapter',
  patch_manuscript_translation: 'manuscript',
};

/**
 * Schema Registry - Single Source of Truth
 *
 * All function call schemas are defined and registered here.
 * This replaces the scattered definitions in chatFunctions.ts, editFunctions.ts,
 * and translationFunctions.ts.
 */

import type { FunctionSchema, FunctionCategory, TargetType, ExecutionMode } from '../types';
import {
  storyObjectTypeSchema,
  translationObjectTypeSchema,
  chapterTypeSchema,
  nameDescReplacementSchema,
  basicInfoReplacementSchema,
  manuscriptReplacementSchema,
  idProperty,
  nameProperty,
  descriptionProperty,
} from './schemaBuilders';

// ============================================================================
// CRUD FUNCTIONS
// ============================================================================

const CREATE_STORY_OBJECT: FunctionSchema = {
  name: 'create_story_object',
  description: 'Create a story object (character, location, organization, or lorebook).',
  category: 'crud',
  target: 'story_object',
  parameters: {
    type: 'object',
    properties: {
      type: storyObjectTypeSchema,
      name: nameProperty,
      description: descriptionProperty,
    },
    required: ['type', 'name', 'description'],
  },
};

const DELETE_STORY_OBJECT: FunctionSchema = {
  name: 'delete_story_object',
  description: 'Delete a story object by ID and type.',
  category: 'crud',
  target: 'story_object',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: storyObjectTypeSchema,
    },
    required: ['id', 'type'],
  },
};

const CREATE_CHAPTER: FunctionSchema = {
  name: 'create_chapter',
  description: 'Create a chapter within an act.',
  category: 'crud',
  target: 'chapter',
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

const DELETE_CHAPTER: FunctionSchema = {
  name: 'delete_chapter',
  description: 'Delete a chapter by ID.',
  category: 'crud',
  target: 'chapter',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the chapter to delete' },
    },
    required: ['id'],
  },
};

// ============================================================================
// OUTLINE CRUD FUNCTIONS
// ============================================================================

const CREATE_OUTLINE: FunctionSchema = {
  name: 'create_outline',
  description: 'Create a new outline for the project.',
  category: 'crud',
  target: 'outline',
  parameters: {
    type: 'object',
    properties: {
      name: nameProperty,
      description: descriptionProperty,
    },
    required: ['name', 'description'],
  },
};

const DELETE_OUTLINE: FunctionSchema = {
  name: 'delete_outline',
  description: 'Delete an outline by ID. This will also delete all acts and chapters within.',
  category: 'crud',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
    },
    required: ['id'],
  },
};

const CREATE_OUTLINE_ACT: FunctionSchema = {
  name: 'create_outline_act',
  description: 'Create an act within an outline.',
  category: 'crud',
  target: 'outline',
  parameters: {
    type: 'object',
    properties: {
      outlineId: { type: 'string', description: 'ID of the parent outline' },
      name: nameProperty,
      description: descriptionProperty,
    },
    required: ['outlineId', 'name', 'description'],
  },
};

const DELETE_OUTLINE_ACT: FunctionSchema = {
  name: 'delete_outline_act',
  description: 'Delete an act by ID. This will also delete all chapters within.',
  category: 'crud',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
    },
    required: ['id'],
  },
};

const CREATE_OUTLINE_CHAPTER: FunctionSchema = {
  name: 'create_outline_chapter',
  description: 'Create a chapter within an act.',
  category: 'crud',
  target: 'outline',
  parameters: {
    type: 'object',
    properties: {
      actId: { type: 'string', description: 'ID of the parent act' },
      name: nameProperty,
      description: descriptionProperty,
    },
    required: ['actId', 'name', 'description'],
  },
};

const DELETE_OUTLINE_CHAPTER: FunctionSchema = {
  name: 'delete_outline_chapter',
  description: 'Delete a chapter by ID.',
  category: 'crud',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
    },
    required: ['id'],
  },
};

// ============================================================================
// REPLACE FUNCTIONS
// ============================================================================

const REPLACE_BASIC_INFO: FunctionSchema = {
  name: 'replace_basic_info',
  description: "Replace project basic info fields. Only include fields you want to change.",
  category: 'replace',
  target: 'basic_info',
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

const REPLACE_STORY_OBJECT: FunctionSchema = {
  name: 'replace_story_object',
  description: 'Replace story object fields. Only include fields you want to change.',
  category: 'replace',
  target: 'story_object',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: storyObjectTypeSchema,
      name: { type: 'string', description: 'New name' },
      description: { type: 'string', description: 'New description' },
    },
    required: ['id', 'type'],
  },
};

const REPLACE_CHAPTER_OUTLINE: FunctionSchema = {
  name: 'replace_chapter_outline',
  description: 'Replace chapter outline fields. Only include fields you want to change.',
  category: 'replace',
  target: 'chapter',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      actId: { type: 'string', description: 'New parent act ID' },
      name: { type: 'string', description: 'New chapter name' },
      description: { type: 'string', description: 'New chapter description' },
      order: { type: 'integer', description: 'New position (1-based). Chapters will be reordered automatically.' },
    },
    required: ['id'],
  },
};

// ============================================================================
// OUTLINE REPLACE FUNCTIONS
// ============================================================================

const REPLACE_OUTLINE: FunctionSchema = {
  name: 'replace_outline',
  description: 'Replace outline fields. Only include fields you want to change.',
  category: 'replace',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      name: { type: 'string', description: 'New outline name' },
      description: { type: 'string', description: 'New outline description' },
    },
    required: ['id'],
  },
};

const REPLACE_OUTLINE_ACT: FunctionSchema = {
  name: 'replace_outline_act',
  description: 'Replace act fields. Only include fields you want to change.',
  category: 'replace',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      name: { type: 'string', description: 'New act name' },
      description: { type: 'string', description: 'New act description' },
      order: { type: 'integer', description: 'New position (1-based). Acts will be reordered automatically.' },
    },
    required: ['id'],
  },
};

const REPLACE_OUTLINE_CHAPTER: FunctionSchema = {
  name: 'replace_outline_chapter',
  description: 'Replace chapter fields. Only include fields you want to change.',
  category: 'replace',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      actId: { type: 'string', description: 'New parent act ID' },
      name: { type: 'string', description: 'New chapter name' },
      description: { type: 'string', description: 'New chapter description' },
      order: { type: 'integer', description: 'New position (1-based). Chapters will be reordered automatically.' },
    },
    required: ['id'],
  },
};

const REPLACE_MANUSCRIPT: FunctionSchema = {
  name: 'replace_manuscript',
  description: 'Replace the entire manuscript content of a chapter.',
  category: 'replace',
  target: 'manuscript',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the manuscript' },
      content: { type: 'string', description: 'Complete new manuscript content' },
    },
    required: ['id', 'content'],
  },
};

// ============================================================================
// PATCH FUNCTIONS
// ============================================================================

const PATCH_BASIC_INFO: FunctionSchema = {
  name: 'patch_basic_info',
  description: 'Patch basic info fields using search and replace. Each replacement finds text and replaces it.',
  category: 'patch',
  target: 'basic_info',
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

const PATCH_STORY_OBJECT: FunctionSchema = {
  name: 'patch_story_object',
  description: 'Patch story object fields using search and replace. Include enough context in "old" to ensure uniqueness.',
  category: 'patch',
  target: 'story_object',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: storyObjectTypeSchema,
      replacements: {
        type: 'array',
        items: nameDescReplacementSchema,
        description: 'List of replacements to apply',
      },
    },
    required: ['id', 'type', 'replacements'],
  },
};

const PATCH_CHAPTER_OUTLINE: FunctionSchema = {
  name: 'patch_chapter_outline',
  description: 'Patch chapter outline fields using search and replace. Can also change order.',
  category: 'patch',
  target: 'chapter',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      replacements: {
        type: 'array',
        items: nameDescReplacementSchema,
        description: 'List of replacements to apply',
      },
      order: { type: 'integer', description: 'New position (1-based). Chapters will be reordered automatically.' },
    },
    required: ['id', 'replacements'],
  },
};

// ============================================================================
// OUTLINE PATCH FUNCTIONS
// ============================================================================

const PATCH_OUTLINE: FunctionSchema = {
  name: 'patch_outline',
  description: 'Patch outline fields using search and replace.',
  category: 'patch',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      replacements: {
        type: 'array',
        items: nameDescReplacementSchema,
        description: 'List of replacements to apply',
      },
    },
    required: ['id', 'replacements'],
  },
};

const PATCH_OUTLINE_ACT: FunctionSchema = {
  name: 'patch_outline_act',
  description: 'Patch act fields using search and replace. Can also change order.',
  category: 'patch',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      replacements: {
        type: 'array',
        items: nameDescReplacementSchema,
        description: 'List of replacements to apply',
      },
      order: { type: 'integer', description: 'New position (1-based). Acts will be reordered automatically.' },
    },
    required: ['id', 'replacements'],
  },
};

const PATCH_OUTLINE_CHAPTER: FunctionSchema = {
  name: 'patch_outline_chapter',
  description: 'Patch chapter fields using search and replace. Can also change order.',
  category: 'patch',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      replacements: {
        type: 'array',
        items: nameDescReplacementSchema,
        description: 'List of replacements to apply',
      },
      order: { type: 'integer', description: 'New position (1-based). Chapters will be reordered automatically.' },
    },
    required: ['id', 'replacements'],
  },
};

const PATCH_MANUSCRIPT: FunctionSchema = {
  name: 'patch_manuscript',
  description: 'Patch manuscript content using search and replace. Include enough context in "old" to ensure uniqueness.',
  category: 'patch',
  target: 'manuscript',
  idParam: 'id',
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
};

// ============================================================================
// TRANSLATION SET FUNCTIONS
// ============================================================================

const SET_BASIC_INFO_TRANSLATION: FunctionSchema = {
  name: 'set_basic_info_translation',
  description: 'Set translation for project basic info.',
  category: 'translation',
  target: 'basic_info',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      title: { type: 'string', description: 'Translated title' },
      logline: { type: 'string', description: 'Translated logline' },
      genre: { type: 'string', description: 'Translated genre' },
    },
    required: ['id', 'title', 'logline', 'genre'],
  },
};

const SET_OBJECT_TRANSLATION: FunctionSchema = {
  name: 'set_object_translation',
  description: 'Set translation for story objects (character, organization, location, lorebook).',
  category: 'translation',
  target: 'story_object',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: translationObjectTypeSchema,
      name: { type: 'string', description: 'Translated name' },
      description: { type: 'string', description: 'Translated description' },
    },
    required: ['id', 'type', 'name', 'description'],
  },
};

const SET_CHAPTER_OUTLINE_TRANSLATION: FunctionSchema = {
  name: 'set_chapter_outline_translation',
  description: 'Set translation for acts or chapters.',
  category: 'translation',
  target: 'chapter',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: chapterTypeSchema,
      name: { type: 'string', description: 'Translated name' },
      description: { type: 'string', description: 'Translated description' },
    },
    required: ['id', 'type', 'name', 'description'],
  },
};

const SET_MANUSCRIPT_TRANSLATION: FunctionSchema = {
  name: 'set_manuscript_translation',
  description: 'Set translation for manuscript content.',
  category: 'translation',
  target: 'manuscript',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      content: { type: 'string', description: 'Translated manuscript content' },
    },
    required: ['id', 'content'],
  },
};

// ============================================================================
// TRANSLATION PATCH FUNCTIONS
// ============================================================================

const PATCH_BASIC_INFO_TRANSLATION: FunctionSchema = {
  name: 'patch_basic_info_translation',
  description: 'Patch basic info translation with search-replace.',
  category: 'translation',
  target: 'basic_info',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      replacements: {
        type: 'array',
        items: basicInfoReplacementSchema,
        description: 'List of search-replace operations',
      },
    },
    required: ['id', 'replacements'],
  },
};

const PATCH_OBJECT_TRANSLATION: FunctionSchema = {
  name: 'patch_object_translation',
  description: 'Patch object translation with search-replace.',
  category: 'translation',
  target: 'story_object',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: translationObjectTypeSchema,
      replacements: {
        type: 'array',
        items: nameDescReplacementSchema,
        description: 'List of search-replace operations',
      },
    },
    required: ['id', 'type', 'replacements'],
  },
};

const PATCH_CHAPTER_OUTLINE_TRANSLATION: FunctionSchema = {
  name: 'patch_chapter_outline_translation',
  description: 'Patch act/chapter translation with search-replace.',
  category: 'translation',
  target: 'chapter',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: chapterTypeSchema,
      replacements: {
        type: 'array',
        items: nameDescReplacementSchema,
        description: 'List of search-replace operations',
      },
    },
    required: ['id', 'type', 'replacements'],
  },
};

const PATCH_MANUSCRIPT_TRANSLATION: FunctionSchema = {
  name: 'patch_manuscript_translation',
  description: 'Patch manuscript translation with search-replace.',
  category: 'translation',
  target: 'manuscript',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      replacements: {
        type: 'array',
        items: manuscriptReplacementSchema,
        description: 'List of search-replace operations',
      },
    },
    required: ['id', 'replacements'],
  },
};

// ============================================================================
// CHAT MESSAGE TRANSLATION
// ============================================================================

const SET_CHAT_MESSAGE_TRANSLATION: FunctionSchema = {
  name: 'set_chat_message_translation',
  description: 'Translate a chat message from one language to another.',
  category: 'translation',
  target: 'basic_info', // Special case - not really a target but needed for typing
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
// SCHEMA REGISTRY CLASS
// ============================================================================

class SchemaRegistryClass {
  private schemas: Map<string, FunctionSchema> = new Map();

  constructor() {
    this.registerAll();
  }

  private registerAll(): void {
    // CRUD - Story Objects
    this.register(CREATE_STORY_OBJECT);
    this.register(DELETE_STORY_OBJECT);
    this.register(CREATE_CHAPTER);
    this.register(DELETE_CHAPTER);

    // CRUD - Outline
    this.register(CREATE_OUTLINE);
    this.register(DELETE_OUTLINE);
    this.register(CREATE_OUTLINE_ACT);
    this.register(DELETE_OUTLINE_ACT);
    this.register(CREATE_OUTLINE_CHAPTER);
    this.register(DELETE_OUTLINE_CHAPTER);

    // Replace - Basic
    this.register(REPLACE_BASIC_INFO);
    this.register(REPLACE_STORY_OBJECT);
    this.register(REPLACE_CHAPTER_OUTLINE);
    this.register(REPLACE_MANUSCRIPT);

    // Replace - Outline
    this.register(REPLACE_OUTLINE);
    this.register(REPLACE_OUTLINE_ACT);
    this.register(REPLACE_OUTLINE_CHAPTER);

    // Patch - Basic
    this.register(PATCH_BASIC_INFO);
    this.register(PATCH_STORY_OBJECT);
    this.register(PATCH_CHAPTER_OUTLINE);
    this.register(PATCH_MANUSCRIPT);

    // Patch - Outline
    this.register(PATCH_OUTLINE);
    this.register(PATCH_OUTLINE_ACT);
    this.register(PATCH_OUTLINE_CHAPTER);

    // Translation Set
    this.register(SET_BASIC_INFO_TRANSLATION);
    this.register(SET_OBJECT_TRANSLATION);
    this.register(SET_CHAPTER_OUTLINE_TRANSLATION);
    this.register(SET_MANUSCRIPT_TRANSLATION);

    // Translation Patch
    this.register(PATCH_BASIC_INFO_TRANSLATION);
    this.register(PATCH_OBJECT_TRANSLATION);
    this.register(PATCH_CHAPTER_OUTLINE_TRANSLATION);
    this.register(PATCH_MANUSCRIPT_TRANSLATION);

    // Chat message translation
    this.register(SET_CHAT_MESSAGE_TRANSLATION);
  }

  register(schema: FunctionSchema): void {
    this.schemas.set(schema.name, schema);
  }

  get(name: string): FunctionSchema | undefined {
    return this.schemas.get(name);
  }

  has(name: string): boolean {
    return this.schemas.has(name);
  }

  getAll(): FunctionSchema[] {
    return Array.from(this.schemas.values());
  }

  getByCategory(category: FunctionCategory): FunctionSchema[] {
    return this.getAll().filter(s => s.category === category);
  }

  getByTarget(target: TargetType): FunctionSchema[] {
    return this.getAll().filter(s => s.target === target);
  }

  /**
   * Get schemas for a specific execution mode
   */
  getForMode(mode: ExecutionMode): FunctionSchema[] {
    switch (mode) {
      case 'storyObject':
        // All CRUD, replace, patch (no translation)
        return this.getAll().filter(s => s.category !== 'translation');

      case 'novelEditor':
        // Only manuscript replace and patch
        return [REPLACE_MANUSCRIPT, PATCH_MANUSCRIPT];

      case 'translation':
        // All translation functions
        return this.getByCategory('translation');

      case 'editAssistant':
        // Replace and patch (no CRUD, no translation)
        return this.getAll().filter(
          s => s.category === 'replace' || s.category === 'patch'
        );

      default:
        return [];
    }
  }

  /**
   * Get LLM-compatible function definitions for a mode
   */
  getFunctionsForLLM(mode: ExecutionMode): Array<{ name: string; description: string; parameters: unknown }> {
    return this.getForMode(mode).map(schema => ({
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    }));
  }
}

// Singleton instance
export const schemaRegistry = new SchemaRegistryClass();

// ============================================================================
// CONVENIENCE EXPORTS
// ============================================================================

/** All function names that perform CRUD operations */
export const CRUD_FUNCTION_NAMES = new Set([
  'create_story_object',
  'delete_story_object',
  'create_chapter',
  'delete_chapter',
  'create_outline',
  'delete_outline',
  'create_outline_act',
  'delete_outline_act',
  'create_outline_chapter',
  'delete_outline_chapter',
]);

/** All function names that perform replace operations */
export const REPLACE_FUNCTION_NAMES = new Set([
  'replace_basic_info',
  'replace_story_object',
  'replace_chapter_outline',
  'replace_manuscript',
  'replace_outline',
  'replace_outline_act',
  'replace_outline_chapter',
]);

/** All function names that perform patch operations */
export const PATCH_FUNCTION_NAMES = new Set([
  'patch_basic_info',
  'patch_story_object',
  'patch_chapter_outline',
  'patch_manuscript',
  'patch_outline',
  'patch_outline_act',
  'patch_outline_chapter',
]);

/** All translation function names */
export const TRANSLATION_FUNCTION_NAMES = new Set([
  'set_basic_info_translation',
  'set_object_translation',
  'set_chapter_outline_translation',
  'set_manuscript_translation',
  'patch_basic_info_translation',
  'patch_object_translation',
  'patch_chapter_outline_translation',
  'patch_manuscript_translation',
  'set_chat_message_translation',
]);

/** Check if a function name is a translation function */
export function isTranslationFunction(name: string): boolean {
  return TRANSLATION_FUNCTION_NAMES.has(name);
}

/** Check if a function name is a CRUD function */
export function isCrudFunction(name: string): boolean {
  return CRUD_FUNCTION_NAMES.has(name);
}

/** Check if a function name is a replace function */
export function isReplaceFunction(name: string): boolean {
  return REPLACE_FUNCTION_NAMES.has(name);
}

/** Check if a function name is a patch function */
export function isPatchFunction(name: string): boolean {
  return PATCH_FUNCTION_NAMES.has(name);
}

// ============================================================================
// FUNCTION GROUPS FOR LLM (for backward compatibility with PromptManager)
// ============================================================================

/** Story object edit functions - excludes manuscript (for edit assistant) */
export const STORY_OBJECT_EDIT_FUNCTIONS = [
  CREATE_STORY_OBJECT,
  DELETE_STORY_OBJECT,
  CREATE_CHAPTER,
  DELETE_CHAPTER,
  REPLACE_BASIC_INFO,
  REPLACE_STORY_OBJECT,
  REPLACE_CHAPTER_OUTLINE,
  PATCH_BASIC_INFO,
  PATCH_STORY_OBJECT,
  PATCH_CHAPTER_OUTLINE,
].map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));

/** Manuscript edit functions (for edit assistant) */
export const MANUSCRIPT_EDIT_FUNCTIONS = [
  REPLACE_MANUSCRIPT,
  PATCH_MANUSCRIPT,
].map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));

/** Outline edit functions (for outline manager) */
export const OUTLINE_EDIT_FUNCTIONS = [
  CREATE_OUTLINE,
  DELETE_OUTLINE,
  CREATE_OUTLINE_ACT,
  DELETE_OUTLINE_ACT,
  CREATE_OUTLINE_CHAPTER,
  DELETE_OUTLINE_CHAPTER,
  REPLACE_OUTLINE,
  REPLACE_OUTLINE_ACT,
  REPLACE_OUTLINE_CHAPTER,
  PATCH_OUTLINE,
  PATCH_OUTLINE_ACT,
  PATCH_OUTLINE_CHAPTER,
].map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));

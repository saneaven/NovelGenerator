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
  description: 'Patch a basic info field using search and replace. For multiple edits, call this function multiple times.',
  category: 'patch',
  target: 'basic_info',
  parameters: {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        enum: ['title', 'logline', 'genre'],
        description: 'Field to patch',
      },
      old: {
        type: 'string',
        description: 'Text to find. Include surrounding context to ensure uniqueness.',
      },
      new: {
        type: 'string',
        description: 'Replacement text',
      },
    },
    required: ['field', 'old', 'new'],
  },
};

const PATCH_STORY_OBJECT: FunctionSchema = {
  name: 'patch_story_object',
  description: 'Patch a story object field using search and replace. For multiple edits, call this function multiple times.',
  category: 'patch',
  target: 'story_object',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: storyObjectTypeSchema,
      field: {
        type: 'string',
        enum: ['name', 'description'],
        description: 'Field to patch',
      },
      old: {
        type: 'string',
        description: 'Text to find. Include surrounding context to ensure uniqueness.',
      },
      new: {
        type: 'string',
        description: 'Replacement text',
      },
    },
    required: ['id', 'type', 'field', 'old', 'new'],
  },
};

// ============================================================================
// OUTLINE PATCH FUNCTIONS
// ============================================================================

const PATCH_OUTLINE: FunctionSchema = {
  name: 'patch_outline',
  description: 'Patch an outline field using search and replace. For multiple edits, call this function multiple times.',
  category: 'patch',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      field: {
        type: 'string',
        enum: ['name', 'description'],
        description: 'Field to patch',
      },
      old: {
        type: 'string',
        description: 'Text to find. Include surrounding context to ensure uniqueness.',
      },
      new: {
        type: 'string',
        description: 'Replacement text',
      },
    },
    required: ['id', 'field', 'old', 'new'],
  },
};

const PATCH_OUTLINE_ACT: FunctionSchema = {
  name: 'patch_outline_act',
  description: 'Patch an act field using search and replace. For multiple edits, call this function multiple times. Can also change order.',
  category: 'patch',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      field: {
        type: 'string',
        enum: ['name', 'description'],
        description: 'Field to patch',
      },
      old: {
        type: 'string',
        description: 'Text to find. Include surrounding context to ensure uniqueness.',
      },
      new: {
        type: 'string',
        description: 'Replacement text',
      },
      order: { type: 'integer', description: 'New position (1-based). Acts will be reordered automatically.' },
    },
    required: ['id', 'field', 'old', 'new'],
  },
};

const PATCH_OUTLINE_CHAPTER: FunctionSchema = {
  name: 'patch_outline_chapter',
  description: 'Patch a chapter field using search and replace. For multiple edits, call this function multiple times. Can also change order or move to another act.',
  category: 'patch',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      field: {
        type: 'string',
        enum: ['name', 'description'],
        description: 'Field to patch',
      },
      old: {
        type: 'string',
        description: 'Text to find. Include surrounding context to ensure uniqueness.',
      },
      new: {
        type: 'string',
        description: 'Replacement text',
      },
      actId: { type: 'string', description: 'New parent act ID' },
      order: { type: 'integer', description: 'New position (1-based). Chapters will be reordered automatically.' },
    },
    required: ['id', 'field', 'old', 'new'],
  },
};

const PATCH_MANUSCRIPT: FunctionSchema = {
  name: 'patch_manuscript',
  description: 'Patch manuscript content using search and replace. For multiple edits, call this function multiple times.',
  category: 'patch',
  target: 'manuscript',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'ID of the manuscript' },
      old: {
        type: 'string',
        description: 'Text to find. Include surrounding context to ensure uniqueness.',
      },
      new: {
        type: 'string',
        description: 'Replacement text',
      },
    },
    required: ['id', 'old', 'new'],
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
    this.register(REPLACE_MANUSCRIPT);

    // Replace - Outline
    this.register(REPLACE_OUTLINE);
    this.register(REPLACE_OUTLINE_ACT);
    this.register(REPLACE_OUTLINE_CHAPTER);

    // Patch - Basic
    this.register(PATCH_BASIC_INFO);
    this.register(PATCH_STORY_OBJECT);
    this.register(PATCH_MANUSCRIPT);

    // Patch - Outline
    this.register(PATCH_OUTLINE);
    this.register(PATCH_OUTLINE_ACT);
    this.register(PATCH_OUTLINE_CHAPTER);
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
  'replace_manuscript',
  'replace_outline',
  'replace_outline_act',
  'replace_outline_chapter',
]);

/** All function names that perform patch operations */
export const PATCH_FUNCTION_NAMES = new Set([
  'patch_basic_info',
  'patch_story_object',
  'patch_manuscript',
  'patch_outline',
  'patch_outline_act',
  'patch_outline_chapter',
]);

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
  CREATE_OUTLINE_CHAPTER,
  DELETE_OUTLINE_CHAPTER,
  REPLACE_BASIC_INFO,
  REPLACE_STORY_OBJECT,
  REPLACE_OUTLINE_CHAPTER,
  PATCH_BASIC_INFO,
  PATCH_STORY_OBJECT,
  PATCH_OUTLINE_CHAPTER,
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

// ============================================================================
// AGENT FUNCTIONS - Full set for Agent mode
// ============================================================================

/** All functions available to Agent mode (CRUD + Replace + Patch, no Translation) */
export const AGENT_FUNCTIONS = [
  // CRUD - Story Objects
  CREATE_STORY_OBJECT,
  DELETE_STORY_OBJECT,
  // CRUD - Outline
  CREATE_OUTLINE,
  DELETE_OUTLINE,
  CREATE_OUTLINE_ACT,
  DELETE_OUTLINE_ACT,
  CREATE_OUTLINE_CHAPTER,
  DELETE_OUTLINE_CHAPTER,
  // Replace
  REPLACE_BASIC_INFO,
  REPLACE_STORY_OBJECT,
  REPLACE_MANUSCRIPT,
  REPLACE_OUTLINE,
  REPLACE_OUTLINE_ACT,
  REPLACE_OUTLINE_CHAPTER,
  // Patch
  PATCH_BASIC_INFO,
  PATCH_STORY_OBJECT,
  PATCH_MANUSCRIPT,
  PATCH_OUTLINE,
  PATCH_OUTLINE_ACT,
  PATCH_OUTLINE_CHAPTER,
].map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));

/** All agent function names for validation */
export const AGENT_FUNCTION_NAMES = AGENT_FUNCTIONS.map(f => f.name);

// ============================================================================
// FUNCTION SETS - Dynamic retrieval by set name
// ============================================================================

/** Available function set names */
export type FunctionSetName = 'agent' | 'manuscript' | 'storyObject' | 'outline' | 'translateObjects';

/** Function set definitions */
const FUNCTION_SET_SCHEMAS: Record<FunctionSetName, FunctionSchema[]> = {
  agent: [
    CREATE_STORY_OBJECT, DELETE_STORY_OBJECT,
    CREATE_OUTLINE, DELETE_OUTLINE, CREATE_OUTLINE_ACT, DELETE_OUTLINE_ACT,
    CREATE_OUTLINE_CHAPTER, DELETE_OUTLINE_CHAPTER,
    REPLACE_BASIC_INFO, REPLACE_STORY_OBJECT, REPLACE_MANUSCRIPT,
    REPLACE_OUTLINE, REPLACE_OUTLINE_ACT, REPLACE_OUTLINE_CHAPTER,
    PATCH_BASIC_INFO, PATCH_STORY_OBJECT, PATCH_MANUSCRIPT,
    PATCH_OUTLINE, PATCH_OUTLINE_ACT, PATCH_OUTLINE_CHAPTER,
  ],
  manuscript: [REPLACE_MANUSCRIPT, PATCH_MANUSCRIPT],
  storyObject: [
    CREATE_STORY_OBJECT, DELETE_STORY_OBJECT,
    REPLACE_BASIC_INFO, REPLACE_STORY_OBJECT,
    PATCH_BASIC_INFO, PATCH_STORY_OBJECT,
  ],
  outline: [
    CREATE_OUTLINE, DELETE_OUTLINE, CREATE_OUTLINE_ACT, DELETE_OUTLINE_ACT,
    CREATE_OUTLINE_CHAPTER, DELETE_OUTLINE_CHAPTER,
    REPLACE_OUTLINE, REPLACE_OUTLINE_ACT, REPLACE_OUTLINE_CHAPTER,
    PATCH_OUTLINE, PATCH_OUTLINE_ACT, PATCH_OUTLINE_CHAPTER,
  ],
  translateObjects: [
    REPLACE_BASIC_INFO, REPLACE_STORY_OBJECT, REPLACE_MANUSCRIPT,
    REPLACE_OUTLINE, REPLACE_OUTLINE_ACT, REPLACE_OUTLINE_CHAPTER,
    PATCH_BASIC_INFO, PATCH_STORY_OBJECT, PATCH_MANUSCRIPT,
    PATCH_OUTLINE, PATCH_OUTLINE_ACT, PATCH_OUTLINE_CHAPTER,
  ],
};

/**
 * Get LLM-compatible function schemas for a specific set
 */
export function getFunctionsForSet(setName: FunctionSetName): FunctionCallSchema[] {
  const schemas = FUNCTION_SET_SCHEMAS[setName];
  return schemas.map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));
}

// ============================================================================
// LLM TYPES
// ============================================================================

/** LLM-compatible function call schema (simplified, no metadata) */
export interface FunctionCallSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

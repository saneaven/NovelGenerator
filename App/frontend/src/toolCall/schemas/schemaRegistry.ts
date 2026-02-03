/**
 * Schema Registry - Single Source of Truth
 *
 * All tool call schemas are defined and registered here.
 * This replaces the scattered definitions in chatTools.ts and editTools.ts.
 */

import type { ToolSchema, ToolCategory, TargetType, ExecutionMode } from '../types';
import {
  storyObjectTypeSchema,
  idProperty,
  nameProperty,
  descriptionProperty,
  contentProperty,
} from './schemaBuilders';

// ============================================================================
// CRUD FUNCTIONS
// ============================================================================

const CREATE_STORY_OBJECT: ToolSchema = {
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
      content: contentProperty,
    },
    required: ['type', 'name', 'content'],
  },
};

const DELETE_STORY_OBJECT: ToolSchema = {
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

const CREATE_OUTLINE: ToolSchema = {
  name: 'create_outline',
  description: 'Create a new outline for the project.',
  category: 'crud',
  target: 'outline',
  parameters: {
    type: 'object',
    properties: {
      name: nameProperty,
      description: descriptionProperty,
      content: contentProperty,
    },
    required: ['name', 'content'],
  },
};

const DELETE_OUTLINE: ToolSchema = {
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

const CREATE_OUTLINE_ACT: ToolSchema = {
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
      content: contentProperty,
    },
    required: ['outlineId', 'name', 'content'],
  },
};

const DELETE_OUTLINE_ACT: ToolSchema = {
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

const CREATE_OUTLINE_CHAPTER: ToolSchema = {
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
      content: contentProperty,
    },
    required: ['actId', 'name', 'content'],
  },
};

const DELETE_OUTLINE_CHAPTER: ToolSchema = {
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

const REPLACE_BASIC_INFO: ToolSchema = {
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

const REPLACE_GUIDELINES: ToolSchema = {
  name: 'replace_guidelines',
  description: 'Replace guidelines author note.',
  category: 'replace',
  target: 'guidelines',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      authorNote: { type: 'string', description: 'New guidelines author note' },
    },
    required: ['id', 'authorNote'],
  },
};

const REPLACE_STORY_OBJECT: ToolSchema = {
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
      description: { type: 'string', description: 'New one-line summary' },
      content: { type: 'string', description: 'New full content' },
    },
    required: ['id', 'type'],
  },
};

// ============================================================================
// OUTLINE REPLACE FUNCTIONS
// ============================================================================

const REPLACE_OUTLINE: ToolSchema = {
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
      description: { type: 'string', description: 'New outline summary' },
      content: { type: 'string', description: 'New outline content' },
    },
    required: ['id'],
  },
};

const REPLACE_OUTLINE_ACT: ToolSchema = {
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
      description: { type: 'string', description: 'New act summary' },
      content: { type: 'string', description: 'New act content' },
      order: { type: 'integer', description: 'New position (1-based). Acts will be reordered automatically.' },
    },
    required: ['id'],
  },
};

const REPLACE_OUTLINE_CHAPTER: ToolSchema = {
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
      description: { type: 'string', description: 'New chapter summary' },
      content: { type: 'string', description: 'New chapter content' },
      order: { type: 'integer', description: 'New position (1-based). Chapters will be reordered automatically.' },
    },
    required: ['id'],
  },
};

const REPLACE_MANUSCRIPT: ToolSchema = {
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

const PATCH_BASIC_INFO: ToolSchema = {
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

const PATCH_GUIDELINES: ToolSchema = {
  name: 'patch_guidelines',
  description: 'Patch guidelines author note using search and replace. For multiple edits, call this function multiple times.',
  category: 'patch',
  target: 'guidelines',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      field: {
        type: 'string',
        enum: ['authorNote'],
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

const PATCH_STORY_OBJECT: ToolSchema = {
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
        enum: ['name', 'description', 'content'],
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

const PATCH_OUTLINE: ToolSchema = {
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
        enum: ['name', 'description', 'content'],
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

const PATCH_OUTLINE_ACT: ToolSchema = {
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
        enum: ['name', 'description', 'content'],
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

const PATCH_OUTLINE_CHAPTER: ToolSchema = {
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
        enum: ['name', 'description', 'content'],
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

const PATCH_MANUSCRIPT: ToolSchema = {
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
// READ FUNCTIONS
// ============================================================================

const READ_STORY_OBJECT: ToolSchema = {
  name: 'read_story_object',
  description: 'Read full content of a story object (character, location, organization, lorebook, basic_info, or guidelines).',
  category: 'read',
  target: 'story_object',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: {
        type: 'string',
        enum: ['character', 'location', 'organization', 'lorebook', 'basic_info', 'guidelines'],
        description: 'Type of story object to read',
      },
    },
    required: ['id', 'type'],
  },
};

const READ_OUTLINE: ToolSchema = {
  name: 'read_outline',
  description: 'Read full content of an outline item (outline, act, or chapter).',
  category: 'read',
  target: 'outline',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      type: {
        type: 'string',
        enum: ['outline', 'act', 'chapter'],
        description: 'Type of outline item to read',
      },
    },
    required: ['id', 'type'],
  },
};

const READ_MANUSCRIPT: ToolSchema = {
  name: 'read_manuscript',
  description: 'Read manuscript content. Use offset to read a specific portion.',
  category: 'read',
  target: 'manuscript',
  idParam: 'id',
  parameters: {
    type: 'object',
    properties: {
      id: idProperty,
      offset: {
        type: 'object',
        description: 'Optional range to read. If omitted, reads entire manuscript.',
        properties: {
          from: { type: 'integer', description: 'Start character position (0-indexed)' },
          to: { type: 'integer', description: 'End character position (exclusive)' },
        },
        required: ['from', 'to'],
      },
    },
    required: ['id'],
  },
};

const RAG_SEARCH: ToolSchema = {
  name: 'rag_search',
  description: 'Search project knowledge base (story objects → outline → manuscript). Results are returned by relevance (embedding distance).',
  category: 'read',
  target: 'story_object',
  parameters: {
    type: 'object',
    properties: {
      queries: {
        type: 'array',
        description: 'Array of search queries. Backend embeds and searches.',
        items: { type: 'string' },
      },
    },
    required: ['queries'],
  },
};

// ============================================================================
// SUB AGENT
// ============================================================================

const RETURN_SUB_AGENT_RESULT: ToolSchema = {
  name: 'return_sub_agent_result',
  description: 'Return the final Sub Agent output and finish the current Sub Agent invocation.',
  category: 'read',
  target: 'sub_agent',
  parameters: {
    type: 'object',
    properties: {
      result: {
        type: 'string',
        description: 'Final Sub Agent output (no summarization; return the full output).',
      },
    },
    required: ['result'],
  },
};

// ============================================================================
// SCHEMA REGISTRY CLASS
// ============================================================================

class SchemaRegistryClass {
  private schemas: Map<string, ToolSchema> = new Map();

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
    this.register(REPLACE_GUIDELINES);
    this.register(REPLACE_STORY_OBJECT);
    this.register(REPLACE_MANUSCRIPT);

    // Replace - Outline
    this.register(REPLACE_OUTLINE);
    this.register(REPLACE_OUTLINE_ACT);
    this.register(REPLACE_OUTLINE_CHAPTER);

    // Patch - Basic
    this.register(PATCH_BASIC_INFO);
    this.register(PATCH_GUIDELINES);
    this.register(PATCH_STORY_OBJECT);
    this.register(PATCH_MANUSCRIPT);

    // Patch - Outline
    this.register(PATCH_OUTLINE);
    this.register(PATCH_OUTLINE_ACT);
    this.register(PATCH_OUTLINE_CHAPTER);

    // Read
    this.register(READ_STORY_OBJECT);
    this.register(READ_OUTLINE);
    this.register(READ_MANUSCRIPT);
    this.register(RAG_SEARCH);

    // Sub Agent
    this.register(RETURN_SUB_AGENT_RESULT);
  }

  register(schema: ToolSchema): void {
    this.schemas.set(schema.name, schema);
  }

  get(name: string): ToolSchema | undefined {
    return this.schemas.get(name);
  }

  has(name: string): boolean {
    return this.schemas.has(name);
  }

  getAll(): ToolSchema[] {
    return Array.from(this.schemas.values());
  }

  getByCategory(category: ToolCategory): ToolSchema[] {
    return this.getAll().filter(s => s.category === category);
  }

  getByTarget(target: TargetType): ToolSchema[] {
    return this.getAll().filter(s => s.target === target);
  }

  /**
   * Get schemas for a specific execution mode
   */
  getForMode(mode: ExecutionMode): ToolSchema[] {
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
   * Get LLM-compatible tool definitions for a mode
   */
  getToolsForLLM(mode: ExecutionMode): Array<{ name: string; description: string; parameters: unknown }> {
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

/** All tool names that perform CRUD operations */
export const CRUD_TOOL_NAMES = new Set([
  'create_story_object',
  'delete_story_object',
  'create_outline',
  'delete_outline',
  'create_outline_act',
  'delete_outline_act',
  'create_outline_chapter',
  'delete_outline_chapter',
]);

/** All tool names that perform replace operations */
export const REPLACE_TOOL_NAMES = new Set([
  'replace_basic_info',
  'replace_guidelines',
  'replace_story_object',
  'replace_manuscript',
  'replace_outline',
  'replace_outline_act',
  'replace_outline_chapter',
]);

/** All tool names that perform patch operations */
export const PATCH_TOOL_NAMES = new Set([
  'patch_basic_info',
  'patch_guidelines',
  'patch_story_object',
  'patch_manuscript',
  'patch_outline',
  'patch_outline_act',
  'patch_outline_chapter',
]);

/** Check if a tool name is a CRUD tool */
export function isCrudTool(name: string): boolean {
  return CRUD_TOOL_NAMES.has(name);
}

/** Check if a tool name is a replace tool */
export function isReplaceTool(name: string): boolean {
  return REPLACE_TOOL_NAMES.has(name);
}

/** Check if a tool name is a patch tool */
export function isPatchTool(name: string): boolean {
  return PATCH_TOOL_NAMES.has(name);
}

/** All tool names that perform read operations */
export const READ_TOOL_NAMES = new Set([
  'read_story_object',
  'read_outline',
  'read_manuscript',
  'rag_search',
]);

/** Check if a tool name is a read tool */
export function isReadTool(name: string): boolean {
  return READ_TOOL_NAMES.has(name) || name.startsWith('call_');
}

// ============================================================================
// TOOL GROUPS FOR LLM
// ============================================================================

/** Story object edit tools - excludes manuscript (for edit assistant) */
export const STORY_OBJECT_EDIT_TOOLS = [
  CREATE_STORY_OBJECT,
  DELETE_STORY_OBJECT,
  CREATE_OUTLINE_CHAPTER,
  DELETE_OUTLINE_CHAPTER,
  REPLACE_BASIC_INFO,
  REPLACE_GUIDELINES,
  REPLACE_STORY_OBJECT,
  REPLACE_OUTLINE_CHAPTER,
  PATCH_BASIC_INFO,
  PATCH_GUIDELINES,
  PATCH_STORY_OBJECT,
  PATCH_OUTLINE_CHAPTER,
].map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));

/** Manuscript edit tools (for edit assistant) */
export const MANUSCRIPT_EDIT_TOOLS = [
  REPLACE_MANUSCRIPT,
  PATCH_MANUSCRIPT,
].map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));

/** Outline edit tools (for outline manager) */
export const OUTLINE_EDIT_TOOLS = [
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
// AGENT TOOLS - Full set for Agent mode
// ============================================================================

/** All tools available to Agent mode (CRUD + Replace + Patch + Read, no Translation) */
export const AGENT_TOOLS = [
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
  REPLACE_GUIDELINES,
  REPLACE_STORY_OBJECT,
  REPLACE_MANUSCRIPT,
  REPLACE_OUTLINE,
  REPLACE_OUTLINE_ACT,
  REPLACE_OUTLINE_CHAPTER,
  // Patch
  PATCH_BASIC_INFO,
  PATCH_GUIDELINES,
  PATCH_STORY_OBJECT,
  PATCH_MANUSCRIPT,
  PATCH_OUTLINE,
  PATCH_OUTLINE_ACT,
  PATCH_OUTLINE_CHAPTER,
  // Read
  READ_STORY_OBJECT,
  READ_OUTLINE,
  READ_MANUSCRIPT,
  RAG_SEARCH,
].map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));

/** All agent tool names for validation */
export const AGENT_TOOL_NAMES = AGENT_TOOLS.map(f => f.name);

// ============================================================================
// TOOL SETS - Dynamic retrieval by set name
// ============================================================================

/** Available tool set names */
export type ToolSetName = 'agent' | 'manuscript' | 'storyObject' | 'outline' | 'translateObjects';

/** Tool set definitions */
const TOOL_SET_SCHEMAS: Record<ToolSetName, ToolSchema[]> = {
  agent: [
    CREATE_STORY_OBJECT, DELETE_STORY_OBJECT,
    CREATE_OUTLINE, DELETE_OUTLINE, CREATE_OUTLINE_ACT, DELETE_OUTLINE_ACT,
    CREATE_OUTLINE_CHAPTER, DELETE_OUTLINE_CHAPTER,
    REPLACE_BASIC_INFO, REPLACE_GUIDELINES, REPLACE_STORY_OBJECT, REPLACE_MANUSCRIPT,
    REPLACE_OUTLINE, REPLACE_OUTLINE_ACT, REPLACE_OUTLINE_CHAPTER,
    PATCH_BASIC_INFO, PATCH_GUIDELINES, PATCH_STORY_OBJECT, PATCH_MANUSCRIPT,
    PATCH_OUTLINE, PATCH_OUTLINE_ACT, PATCH_OUTLINE_CHAPTER,
    READ_STORY_OBJECT, READ_OUTLINE, READ_MANUSCRIPT, RAG_SEARCH,
  ],
  manuscript: [REPLACE_MANUSCRIPT, PATCH_MANUSCRIPT],
  storyObject: [
    CREATE_STORY_OBJECT, DELETE_STORY_OBJECT,
    REPLACE_BASIC_INFO, REPLACE_GUIDELINES, REPLACE_STORY_OBJECT,
    PATCH_BASIC_INFO, PATCH_GUIDELINES, PATCH_STORY_OBJECT,
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
    REPLACE_GUIDELINES,
    PATCH_BASIC_INFO, PATCH_GUIDELINES, PATCH_STORY_OBJECT, PATCH_MANUSCRIPT,
    PATCH_OUTLINE, PATCH_OUTLINE_ACT, PATCH_OUTLINE_CHAPTER,
  ],
};

/**
 * Get LLM-compatible tool schemas for a specific set
 */
export interface ToolSetOptions {
  ragSearchEnabled?: boolean;
}

export function getToolsForSet(setName: ToolSetName, options?: ToolSetOptions): ToolCallSchema[] {
  const schemas = TOOL_SET_SCHEMAS[setName];
  const ragEnabled = options?.ragSearchEnabled ?? true;

  const filtered =
    setName === 'agent' && !ragEnabled
      ? schemas.filter((s) => s.name !== 'rag_search')
      : schemas;

  return filtered.map(s => ({ name: s.name, description: s.description, parameters: s.parameters }));
}

// ============================================================================
// LLM TYPES
// ============================================================================

/** LLM-compatible tool call schema (simplified, no metadata) */
export interface ToolCallSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

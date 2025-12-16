/**
 * Translation Function Schemas
 *
 * Type-specific translation functions following CRUD pattern.
 * Each object type has its own translation function with exact parameters.
 */

import type { FunctionCallSchema } from './chatFunctions';

// ============================================================================
// BASE FIELDS
// ============================================================================

const baseIdField = {
  id: { type: "string", description: "ID of the object to translate" },
};

const baseNameDescFields = {
  name: { type: "string", description: "Translated name" },
  description: { type: "string", description: "Translated description" },
};

// ============================================================================
// TYPE-SPECIFIC TRANSLATION FUNCTIONS
// ============================================================================

/**
 * Translation functions for story objects - one function per object type
 */
export const TRANSLATION_FUNCTIONS: FunctionCallSchema[] = [
  // Character
  {
    name: "translate_character",
    description: "Translate a character's name and description.",
    parameters: {
      type: "object",
      properties: { ...baseIdField, ...baseNameDescFields },
      required: ["id", "name", "description"],
    },
  },

  // Organization
  {
    name: "translate_organization",
    description: "Translate an organization's name and description.",
    parameters: {
      type: "object",
      properties: { ...baseIdField, ...baseNameDescFields },
      required: ["id", "name", "description"],
    },
  },

  // Location
  {
    name: "translate_location",
    description: "Translate a location's name and description.",
    parameters: {
      type: "object",
      properties: { ...baseIdField, ...baseNameDescFields },
      required: ["id", "name", "description"],
    },
  },

  // Lorebook Entry
  {
    name: "translate_lorebook_entry",
    description: "Translate a lorebook entry's name and description.",
    parameters: {
      type: "object",
      properties: { ...baseIdField, ...baseNameDescFields },
      required: ["id", "name", "description"],
    },
  },

  // Act
  {
    name: "translate_act",
    description: "Translate an act's name and description.",
    parameters: {
      type: "object",
      properties: { ...baseIdField, ...baseNameDescFields },
      required: ["id", "name", "description"],
    },
  },

  // Chapter
  {
    name: "translate_chapter",
    description: "Translate a chapter's name and description.",
    parameters: {
      type: "object",
      properties: { ...baseIdField, ...baseNameDescFields },
      required: ["id", "name", "description"],
    },
  },

  // Basic Info
  {
    name: "translate_basic_info",
    description: "Translate the project's basic info (title, logline, genre).",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
        title: { type: "string", description: "Translated title" },
        logline: { type: "string", description: "Translated logline" },
        genre: { type: "string", description: "Translated genre" },
      },
      required: ["id", "title", "logline", "genre"],
    },
  },

  // Manuscript
  {
    name: "translate_manuscript",
    description: "Translate the manuscript content of a chapter.",
    parameters: {
      type: "object",
      properties: {
        ...baseIdField,
        content: { type: "string", description: "Translated manuscript content" },
      },
      required: ["id", "content"],
    },
  },
];

// ============================================================================
// CHAT MESSAGE TRANSLATION
// ============================================================================

/**
 * Chat message translation function schema
 */
export const TRANSLATE_CHAT_MESSAGE_FUNCTION: FunctionCallSchema = {
  name: "translate_chat_message",
  description: "Translate a chat message from one language to another.",
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Translated message content"
      }
    },
    required: ["content"]
  }
};

/**
 * Get chat translation functions
 */
export const CHAT_TRANSLATION_FUNCTIONS: FunctionCallSchema[] = [
  TRANSLATE_CHAT_MESSAGE_FUNCTION
];

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Map function names to object types
 */
export const TRANSLATION_FUNCTION_TO_TYPE: Record<string, string> = {
  'translate_character': 'character',
  'translate_organization': 'organization',
  'translate_location': 'location',
  'translate_lorebook_entry': 'lorebook',
  'translate_act': 'act',
  'translate_chapter': 'chapter',
  'translate_basic_info': 'basic_info',
  'translate_manuscript': 'manuscript',
};

/**
 * Get translation function names as a Set for quick lookup
 */
export const TRANSLATION_FUNCTION_NAMES = new Set(
  TRANSLATION_FUNCTIONS.map(f => f.name)
);

// ============================================================================
// EXPORTS
// ============================================================================

export default TRANSLATION_FUNCTIONS;

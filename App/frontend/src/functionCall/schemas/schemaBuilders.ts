/**
 * Schema Building Blocks
 *
 * Shared schema components used across multiple function definitions.
 * Keeps schemas DRY and consistent.
 */

// ============================================================================
// STORY OBJECT TYPE ENUMS
// ============================================================================

/** Story object types (for create/delete/replace/patch) */
export const STORY_OBJECT_TYPES = [
  'character',
  'location',
  'organization',
  'lorebook',
] as const;

/** Object types for translation (excludes outline structure) */
export const TRANSLATION_OBJECT_TYPES = [
  'character',
  'organization',
  'location',
  'lorebook',
] as const;

/** Outline structure types (outline, act, chapter) */
export const OUTLINE_TYPES = ['outline', 'act', 'chapter'] as const;

/** Chapter types (act or chapter) - legacy, use OUTLINE_TYPES for new code */
export const CHAPTER_TYPES = ['act', 'chapter'] as const;

// ============================================================================
// FIELD SCHEMAS
// ============================================================================

/** Schema for story object type field */
export const storyObjectTypeSchema = {
  type: 'string',
  enum: STORY_OBJECT_TYPES,
  description: 'Type of story object',
};

/** Schema for translation object type field */
export const translationObjectTypeSchema = {
  type: 'string',
  enum: TRANSLATION_OBJECT_TYPES,
  description: 'Type of the object',
};

/** Schema for chapter type field */
export const chapterTypeSchema = {
  type: 'string',
  enum: CHAPTER_TYPES,
  description: 'Type: act or chapter',
};

// ============================================================================
// REPLACEMENT SCHEMAS
// ============================================================================

/** Schema for name/description field replacement */
export const nameDescReplacementSchema = {
  type: 'object',
  properties: {
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
  required: ['field', 'old', 'new'],
};

/** Schema for basic info field replacement */
export const basicInfoReplacementSchema = {
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
};

/** Schema for manuscript replacement (content only, no field) */
export const manuscriptReplacementSchema = {
  type: 'object',
  properties: {
    old: {
      type: 'string',
      description: 'Text to find. Include surrounding context to ensure uniqueness.',
    },
    new: {
      type: 'string',
      description: 'Replacement text',
    },
  },
  required: ['old', 'new'],
};

// ============================================================================
// COMMON PROPERTIES
// ============================================================================

export const idProperty = {
  type: 'string',
  description: 'ID of the object',
};

export const nameProperty = {
  type: 'string',
  description: 'Name of the object',
};

export const descriptionProperty = {
  type: 'string',
  description: 'Description of the object',
};

export const contentProperty = {
  type: 'string',
  description: 'Content text',
};

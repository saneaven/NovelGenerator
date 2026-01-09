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

/** TypeScript type derived from STORY_OBJECT_TYPES */
export type StoryObjectType = (typeof STORY_OBJECT_TYPES)[number];

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

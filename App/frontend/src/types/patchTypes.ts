/**
 * Patch Types for Search-Replace based editing
 *
 * This module defines types for the patch system where:
 * - replace_* functions: Full field replacement
 * - patch_* functions: Search and replace within fields
 */

// ============================================
// REPLACEMENT TYPES
// ============================================

/**
 * A single replacement operation for patch functions.
 * - `field`: Which field to patch (for story objects, chapters, basic info)
 * - `old`: Text to find (include surrounding context for uniqueness)
 * - `new`: Replacement text
 */
export interface Replacement {
  field?: string;
  old: string;
  new: string;
}

/**
 * Result of applying patch operations
 */
export interface PatchResult {
  success: boolean;
  value: string;
  error?: string;
  /** True if patch failed and retry with replace function should be attempted */
  needsRetry?: boolean;
}

/**
 * Context for retry attempts when patch fails.
 * Used to prompt AI to use replace_* function instead.
 */
export interface PatchRetryContext {
  objectId: string;
  objectType?: string;
  fieldName: string;
  currentValue: string;
  error: string;
}

// ============================================
// STORY OBJECT TYPES (for type enum)
// ============================================

export type StoryObjectType =
  | 'character'
  | 'location'
  | 'item'
  | 'event'
  | 'act'
  | 'other';

export const STORY_OBJECT_TYPES: StoryObjectType[] = [
  'character',
  'location',
  'item',
  'event',
  'act',
  'other',
];

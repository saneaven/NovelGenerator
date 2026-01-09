/**
 * Patch Types for Search-Replace based editing
 *
 * This module defines types for the patch system where:
 * - replace_* functions: Full field replacement
 * - patch_* functions: Search and replace within fields (single replacement per call)
 */

import {
  STORY_OBJECT_TYPES,
  type StoryObjectType,
} from '../functionCall/schemas/schemaBuilders';

// Re-export for backward compatibility
export { STORY_OBJECT_TYPES, type StoryObjectType };

// ============================================
// PATCH RESULT TYPE
// ============================================

/**
 * Result of applying a single patch operation
 */
export interface PatchResult {
  success: boolean;
  value: string;
  error?: string;
}

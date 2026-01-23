/**
 * Validator Registry
 *
 * Maps tool names to their validators.
 * Validators are run in order - first failure stops validation.
 */

import type { Validator } from './types';
import {
  validateTypeMapping,
  validateRequiredId,
  validatePatchRequiredFields,
  validateObjectExists,
  validatePatchApplicable,
  validateOutlineParentExists,
  validateActParentExists,
} from './validators';

// ============================================================================
// TOOL TO VALIDATORS MAPPING
// ============================================================================

/**
 * Registry mapping tool names to their validators.
 * Validators are executed in array order; first failure stops the chain.
 */
export const TOOL_VALIDATORS: Record<string, Validator[]> = {
  // -------------------------------------------------------------------------
  // CRUD Operations
  // -------------------------------------------------------------------------
  create_story_object: [validateTypeMapping],
  delete_story_object: [validateTypeMapping, validateRequiredId, validateObjectExists],
  create_outline: [],
  delete_outline: [validateRequiredId, validateObjectExists],
  create_outline_act: [validateOutlineParentExists],
  delete_outline_act: [validateRequiredId, validateObjectExists],
  create_outline_chapter: [validateActParentExists],
  delete_outline_chapter: [validateRequiredId, validateObjectExists],

  // -------------------------------------------------------------------------
  // Replace Operations
  // -------------------------------------------------------------------------
  replace_basic_info: [],
  replace_story_object: [validateTypeMapping, validateRequiredId, validateObjectExists],
  replace_manuscript: [validateRequiredId, validateObjectExists],
  replace_outline: [validateRequiredId, validateObjectExists],
  replace_outline_act: [validateRequiredId, validateObjectExists],
  replace_outline_chapter: [validateRequiredId, validateObjectExists],

  // -------------------------------------------------------------------------
  // Patch Operations
  // -------------------------------------------------------------------------
  patch_basic_info: [validatePatchRequiredFields, validateObjectExists, validatePatchApplicable],
  patch_story_object: [
    validateTypeMapping,
    validateRequiredId,
    validatePatchRequiredFields,
    validateObjectExists,
    validatePatchApplicable,
  ],
  patch_manuscript: [
    validateRequiredId,
    validatePatchRequiredFields,
    validateObjectExists,
    validatePatchApplicable,
  ],
  patch_outline: [validateRequiredId, validatePatchRequiredFields, validateObjectExists, validatePatchApplicable],
  patch_outline_act: [
    validateRequiredId,
    validatePatchRequiredFields,
    validateObjectExists,
    validatePatchApplicable,
  ],
  patch_outline_chapter: [
    validateRequiredId,
    validatePatchRequiredFields,
    validateObjectExists,
    validatePatchApplicable,
  ],

  // -------------------------------------------------------------------------
  // Translation Set Operations
  // -------------------------------------------------------------------------
  set_basic_info_translation: [validateRequiredId, validateObjectExists],
  set_object_translation: [validateTypeMapping, validateRequiredId, validateObjectExists],
  set_chapter_outline_translation: [validateTypeMapping, validateRequiredId, validateObjectExists],
  set_manuscript_translation: [validateRequiredId, validateObjectExists],

  // -------------------------------------------------------------------------
  // Translation Patch Operations
  // -------------------------------------------------------------------------
  patch_basic_info_translation: [
    validateRequiredId,
    validatePatchRequiredFields,
    validateObjectExists,
    validatePatchApplicable,
  ],
  patch_object_translation: [
    validateTypeMapping,
    validateRequiredId,
    validatePatchRequiredFields,
    validateObjectExists,
    validatePatchApplicable,
  ],
  patch_chapter_outline_translation: [
    validateTypeMapping,
    validateRequiredId,
    validatePatchRequiredFields,
    validateObjectExists,
    validatePatchApplicable,
  ],
  patch_manuscript_translation: [
    validateRequiredId,
    validatePatchRequiredFields,
    validateObjectExists,
    validatePatchApplicable,
  ],

  // -------------------------------------------------------------------------
  // Read Operations
  // -------------------------------------------------------------------------
  read_story_object: [validateTypeMapping, validateRequiredId, validateObjectExists],
  read_outline: [validateRequiredId, validateObjectExists],
  read_manuscript: [validateRequiredId, validateObjectExists],
};

/**
 * Get validators for a tool name.
 * Returns empty array if no validators registered.
 */
export function getValidators(toolName: string): Validator[] {
  return TOOL_VALIDATORS[toolName] ?? [];
}

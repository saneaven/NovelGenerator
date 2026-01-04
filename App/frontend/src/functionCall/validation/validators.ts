/**
 * Validators
 *
 * Individual validator functions for function call validation.
 * Validators access stores directly via getState() for async operations.
 */

import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { ObjectType } from '../../types/unifiedObject';
import type { ValidationResult, Validator } from './types';
import { validResult, invalidResult } from './types';
import { STORY_OBJECT_TYPE_MAP, ALL_OBJECT_TYPE_MAP, type StoryObjectSubtype } from '../types';
import { applyPatch } from '../../utils/patchUtils';
import { getObjectData } from '../types';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Resolve ObjectType from function arguments and function name
 */
export function resolveObjectType(
  args: Record<string, unknown>,
  functionName: string
): ObjectType | null {
  const type = args.type as string | undefined;

  // Story object functions
  if (functionName.includes('story_object') && type) {
    return STORY_OBJECT_TYPE_MAP[type as StoryObjectSubtype] ?? null;
  }

  // Outline functions
  if (functionName.includes('outline_act')) {
    return 'act';
  }
  if (functionName.includes('outline_chapter')) {
    return 'chapter';
  }
  if (functionName === 'patch_outline' || functionName === 'replace_outline') {
    return 'outline';
  }

  // Basic info
  if (functionName.includes('basic_info')) {
    return 'basic_info';
  }

  // Manuscript
  if (functionName.includes('manuscript')) {
    return 'manuscript';
  }

  // Translation with type argument
  if (functionName.includes('_translation') && type) {
    return ALL_OBJECT_TYPE_MAP[type] ?? null;
  }

  return null;
}

// ============================================================================
// SYNC VALIDATORS
// ============================================================================

/**
 * Validate that the type argument maps to a valid ObjectType
 */
export const validateTypeMapping: Validator = (args, functionName) => {
  const type = args.type as string | undefined;

  // Only validate if type argument is present
  if (!type) {
    return validResult();
  }

  // Check story object type mapping
  if (functionName.includes('story_object')) {
    if (!STORY_OBJECT_TYPE_MAP[type as StoryObjectSubtype]) {
      return invalidResult(`Unknown story object type: ${type}`);
    }
  }

  // Check translation object type mapping (includes all object types)
  if (functionName.includes('_translation')) {
    if (!ALL_OBJECT_TYPE_MAP[type]) {
      return invalidResult(`Unknown object type for translation: ${type}`);
    }
  }

  return validResult();
};

/**
 * Validate that required ID field is present
 */
export const validateRequiredId: Validator = (args, functionName) => {
  const id = args.id as string | undefined;

  // Create operations don't require ID
  if (functionName.startsWith('create_')) {
    return validResult();
  }

  // All other operations require ID
  if (!id) {
    return invalidResult(`Missing required id for ${functionName}`);
  }

  return validResult();
};

/**
 * Validate required fields for patch operations
 */
export const validatePatchRequiredFields: Validator = (args, functionName) => {
  if (!functionName.startsWith('patch_')) {
    return validResult();
  }

  const replacements = args.replacements as unknown[] | undefined;
  if (!replacements || !Array.isArray(replacements)) {
    return invalidResult(`Missing replacements for ${functionName}`);
  }

  return validResult();
};

// ============================================================================
// ASYNC VALIDATORS
// ============================================================================

/**
 * Validate that the object exists in the store (fetching if needed)
 */
export const validateObjectExists: Validator = async (args, functionName) => {
  const id = args.id as string | undefined;

  // Create operations don't need existing object
  if (functionName.startsWith('create_') || !id) {
    return validResult();
  }

  const store = useUnifiedObjectStore.getState();

  // Check if already in cache
  let object = store.getObject(id);

  if (!object) {
    // Try to fetch from API
    const objectType = resolveObjectType(args, functionName);
    if (!objectType) {
      return invalidResult(`Cannot determine object type for ${functionName}`);
    }

    try {
      await store.fetchObject(objectType, id);
      object = store.getObject(id);
    } catch (error) {
      return invalidResult(`Failed to fetch object ${id}: ${error}`);
    }
  }

  if (!object) {
    return invalidResult(`Object with id ${id} not found`);
  }

  return validResult();
};

/**
 * Validate that patch replacements can be applied to current content.
 * Note: applyPatch returns original text on failure, so running it is effectively a dry run.
 */
export const validatePatchApplicable: Validator = async (args, functionName) => {
  if (!functionName.startsWith('patch_')) {
    return validResult();
  }

  const id = args.id as string | undefined;
  const replacements = args.replacements as Array<{ old: string; new: string; field?: string }> | undefined;

  if (!id || !replacements) {
    return validResult(); // Already validated by other validators
  }

  const store = useUnifiedObjectStore.getState();
  const object = store.getObject(id);

  if (!object) {
    return validResult(); // Already validated by validateObjectExists
  }

  // Get current data - use first available language for validation
  const languages = Object.keys(object.data);
  if (languages.length === 0) {
    return validResult(); // No data to validate against
  }

  const currentData = getObjectData(object, languages[0]);
  const failures: string[] = [];

  // For manuscript patches (no field property), validate against content
  if (functionName.includes('manuscript')) {
    const content = (currentData.content as string) ?? '';
    const result = applyPatch(content, replacements);
    if (!result.success && result.failureCount && result.failureCount > 0) {
      failures.push(`content: ${result.error}`);
    }
  } else {
    // For other patches with field property
    for (const r of replacements) {
      if (!r.field) continue;

      const fieldValue = (currentData[r.field] as string) ?? '';
      const result = applyPatch(fieldValue, [{ old: r.old, new: r.new }]);

      if (!result.success) {
        failures.push(`${r.field}: ${result.error}`);
      }
    }
  }

  if (failures.length > 0) {
    return invalidResult(`Patch validation failed:\n${failures.join('\n')}`);
  }

  return validResult();
};

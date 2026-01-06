/**
 * Validators
 *
 * Individual validator functions for function call validation.
 * Validators access stores directly via getState() for async operations.
 */

import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { ObjectType } from '../../types/unifiedObject';
import type { Validator } from './types';
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
  if (functionName === 'patch_outline' || functionName === 'replace_outline' || functionName === 'delete_outline') {
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
export const validateTypeMapping: Validator = (args, functionName, _context) => {
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
export const validateRequiredId: Validator = (args, functionName, _context) => {
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
export const validatePatchRequiredFields: Validator = (args, functionName, _context) => {
  if (!functionName.startsWith('patch_')) {
    return validResult();
  }

  const replacements = args.replacements as unknown[] | undefined;
  if (!replacements || !Array.isArray(replacements)) {
    return invalidResult(`Missing replacements for ${functionName}`);
  }

  const hasStructuralChange = args.order !== undefined || args.actId !== undefined;

  if (replacements.length === 0 && !hasStructuralChange) {
    return invalidResult(`No replacements provided for ${functionName}`);
  }

  return validResult();
};

// ============================================================================
// ASYNC VALIDATORS
// ============================================================================

/**
 * Validate that the object exists in the store (fetching if needed)
 */
export const validateObjectExists: Validator = async (args, functionName, context) => {
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

  const objectProjectId = object.metadata?.project_id;
  if (!objectProjectId) {
    return invalidResult(`Object ${id} is missing project_id metadata`);
  }

  if (objectProjectId !== context.projectId) {
    return invalidResult(`Object ${id} belongs to a different project`);
  }

  return validResult();
};

/**
 * Validate that patch replacements can be applied to current content.
 * Note: applyPatch returns original text on failure, so running it is effectively a dry run.
 */
export const validatePatchApplicable: Validator = async (args, functionName, _context) => {
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
  let successCount = 0;

  // For manuscript patches (no field property), validate against content
  if (functionName.includes('manuscript')) {
    const content = (currentData.content as string) ?? '';
    const result = applyPatch(content, replacements);
    successCount = result.successCount ?? 0;
    if (successCount === 0) {
      failures.push(`content: ${result.error}`);
    }
  } else {
    // For other patches with field property
    for (const r of replacements) {
      if (!r.field) {
        failures.push(`unknown: missing field for replacement`);
        continue;
      }

      const fieldValue = (currentData[r.field] as string) ?? '';
      const result = applyPatch(fieldValue, [{ old: r.old, new: r.new }]);

      const applied = result.successCount ?? 0;
      if (applied > 0) {
        successCount += 1;
      } else {
        failures.push(`${r.field}: ${result.error}`);
      }
    }
  }

  if (successCount === 0 && failures.length > 0) {
    return invalidResult(`Patch validation failed:\n${failures.join('\n')}`);
  }

  return validResult();
};

// ============================================================================
// OUTLINE PARENT VALIDATORS
// ============================================================================

export const validateOutlineParentExists: Validator = async (args, functionName, context) => {
  if (functionName !== 'create_outline_act') {
    return validResult();
  }

  const outlineId = args.outlineId as string | undefined;
  if (!outlineId || !outlineId.trim()) {
    return invalidResult('Missing outlineId for create_outline_act');
  }

  const store = useUnifiedObjectStore.getState();

  let outline = store.getObject(outlineId);
  if (!outline) {
    try {
      await store.fetchObject('outline', outlineId);
      outline = store.getObject(outlineId);
    } catch (error) {
      return invalidResult(`Failed to fetch outline ${outlineId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!outline) {
    return invalidResult(`Parent outline not found: ${outlineId}`);
  }

  const projectId = outline.metadata?.project_id;
  if (!projectId) {
    return invalidResult(`Parent outline ${outlineId} is missing project_id metadata`);
  }

  if (projectId !== context.projectId) {
    return invalidResult(`Parent outline ${outlineId} belongs to a different project`);
  }

  return validResult();
};

export const validateActParentExists: Validator = async (args, functionName, context) => {
  if (functionName !== 'create_outline_chapter') {
    return validResult();
  }

  const actId = args.actId as string | undefined;
  if (!actId || !actId.trim()) {
    return invalidResult('Missing actId for create_outline_chapter');
  }

  const store = useUnifiedObjectStore.getState();

  let act = store.getObject(actId);
  if (!act) {
    try {
      await store.fetchObject('act', actId);
      act = store.getObject(actId);
    } catch (error) {
      return invalidResult(`Failed to fetch act ${actId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!act) {
    return invalidResult(`Parent act not found: ${actId}`);
  }

  const projectId = act.metadata?.project_id;
  if (!projectId) {
    return invalidResult(`Parent act ${actId} is missing project_id metadata`);
  }

  if (projectId !== context.projectId) {
    return invalidResult(`Parent act ${actId} belongs to a different project`);
  }

  return validResult();
};

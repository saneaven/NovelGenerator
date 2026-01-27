/**
 * Validators
 *
 * Individual validator functions for tool call validation.
 * Validators access stores directly via getState() for async operations.
 */

import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { ObjectType } from '../../types/unifiedObject';
import type { Validator } from './types';
import { validResult, invalidResult } from './types';
import { STORY_OBJECT_TYPE_MAP, ALL_OBJECT_TYPE_MAP, type StoryObjectSubtype } from '../types';
import { applySingleReplacement } from '../../utils/patchUtils';
import { getObjectData } from '../types';
import { docToMarkdown } from '../../editor/manuscript/convert';
import { normalizeDoc } from '../../editor/manuscript/doc';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Resolve ObjectType from function arguments and function name
 */
export function resolveObjectType(
  args: Record<string, unknown>,
  toolName: string
): ObjectType | null {
  const type = args.type as string | undefined;

  // Read functions - resolve from args.type
  if (toolName === 'read_story_object' && type) {
    // read_story_object can read basic_info and guidelines too
    if (type === 'basic_info') return 'basic_info';
    if (type === 'guidelines') return 'guidelines';
    return STORY_OBJECT_TYPE_MAP[type as StoryObjectSubtype] ?? null;
  }
  if (toolName === 'read_outline' && type) {
    // type is 'outline' | 'act' | 'chapter'
    if (type === 'outline' || type === 'act' || type === 'chapter') {
      return type as ObjectType;
    }
    return null;
  }
  if (toolName === 'read_manuscript') {
    return 'manuscript';
  }

  // Story object functions
  if (toolName.includes('story_object') && type) {
    return STORY_OBJECT_TYPE_MAP[type as StoryObjectSubtype] ?? null;
  }

  // Outline functions
  if (toolName.includes('outline_act')) {
    return 'act';
  }
  if (toolName.includes('outline_chapter')) {
    return 'chapter';
  }
  if (toolName === 'patch_outline' || toolName === 'replace_outline' || toolName === 'delete_outline') {
    return 'outline';
  }

  // Basic info
  if (toolName.includes('basic_info')) {
    return 'basic_info';
  }

  // Manuscript
  if (toolName.includes('manuscript')) {
    return 'manuscript';
  }

  // Translation with type argument
  if (toolName.includes('_translation') && type) {
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
export const validateTypeMapping: Validator = (args, toolName, _context) => {
  const type = args.type as string | undefined;

  // Only validate if type argument is present
  if (!type) {
    return validResult();
  }

  // Check story object type mapping
  if (toolName.includes('story_object')) {
    if (!STORY_OBJECT_TYPE_MAP[type as StoryObjectSubtype]) {
      return invalidResult(`Unknown story object type: ${type}`);
    }
  }

  // Check translation object type mapping (includes all object types)
  if (toolName.includes('_translation')) {
    if (!ALL_OBJECT_TYPE_MAP[type]) {
      return invalidResult(`Unknown object type for translation: ${type}`);
    }
  }

  return validResult();
};

/**
 * Validate that required ID field is present
 */
export const validateRequiredId: Validator = (args, toolName, _context) => {
  const id = args.id as string | undefined;

  // Create operations don't require ID
  if (toolName.startsWith('create_')) {
    return validResult();
  }

  // All other operations require ID
  if (!id) {
    return invalidResult(`Missing required id for ${toolName}`);
  }

  return validResult();
};

/**
 * Validate required fields for patch operations
 */
export const validatePatchRequiredFields: Validator = (args, toolName, _context) => {
  if (!toolName.startsWith('patch_')) {
    return validResult();
  }

  const oldText = args.old as string | undefined;
  const newText = args.new as string | undefined;

  if (!oldText || newText === undefined) {
    return invalidResult(`Missing required fields (old, new) for ${toolName}`);
  }

  // For non-manuscript patches, field is required
  if (!toolName.includes('manuscript')) {
    const field = args.field as string | undefined;
    if (!field) {
      return invalidResult(`Missing required field 'field' for ${toolName}`);
    }
  }

  return validResult();
};

/**
 * Validate that RAG Search is enabled for rag_search tool calls.
 */
export const validateRagSearchEnabled: Validator = (_args, toolName, _context) => {
  if (toolName !== 'rag_search') return validResult();

  const enabled = useSettingsStore.getState().settings.ragSearchEnabled;
  if (!enabled) {
    return invalidResult('Embeddings are disabled (Settings > RAG Search)');
  }

  return validResult();
};

// ============================================================================
// ASYNC VALIDATORS
// ============================================================================

/**
 * Validate that the object exists in the store (fetching if needed)
 */
export const validateObjectExists: Validator = async (args, toolName, context) => {
  const id = args.id as string | undefined;

  // Create operations don't need existing object
  if (toolName.startsWith('create_') || !id) {
    return validResult();
  }

  const store = useUnifiedObjectStore.getState();

  // Check if already in cache
  let object = store.getObject(id);

  if (!object) {
    // Try to fetch from API
    const objectType = resolveObjectType(args, toolName);
    if (!objectType) {
      return invalidResult(`Cannot determine object type for ${toolName}`);
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
 * Validate that patch replacement can be applied to current content.
 * Uses applySingleReplacement as a dry run to check if the patch will succeed.
 */
export const validatePatchApplicable: Validator = async (args, toolName, context) => {
  if (!toolName.startsWith('patch_')) {
    return validResult();
  }

  const id = args.id as string | undefined;
  const oldText = args.old as string | undefined;
  const newText = args.new as string | undefined;
  const field = args.field as string | undefined;

  // For basic_info, id is not required
  if (toolName !== 'patch_basic_info' && !id) {
    return validResult(); // Already validated by other validators
  }

  if (!oldText || newText === undefined) {
    return validResult(); // Already validated by validatePatchRequiredFields
  }

  const store = useUnifiedObjectStore.getState();

  // For basic_info, we need to get the object differently
  if (toolName === 'patch_basic_info') {
    const existing = await store.listObjects('basic_info', context.projectId);
    if (existing.length === 0) {
      return invalidResult('No basic info found to patch');
    }
    const object = existing[0];
    const currentData = getObjectData(object, context.language);
    const fieldValue = (currentData[field as string] as string) ?? '';
    const result = applySingleReplacement(fieldValue, oldText, newText);
    if (!result.success) {
      return invalidResult(`Patch validation failed: [${field}] ${result.error}`);
    }
    return validResult();
  }

  const object = store.getObject(id as string);
  if (!object) {
    return validResult(); // Already validated by validateObjectExists
  }

  const currentData = getObjectData(object, context.language);

  // For manuscript patches (no field property), validate against content
  if (toolName.includes('manuscript')) {
    const currentDoc = normalizeDoc((currentData as any).doc);
    const markdown = docToMarkdown(currentDoc);
    const result = applySingleReplacement(markdown, oldText, newText);
    if (!result.success) {
      return invalidResult(`Patch validation failed: ${result.error}`);
    }
  } else {
    // For other patches with field property
    if (!field) {
      return invalidResult('Missing field for patch validation');
    }
    const fieldValue = (currentData[field] as string) ?? '';
    const result = applySingleReplacement(fieldValue, oldText, newText);
    if (!result.success) {
      return invalidResult(`Patch validation failed: [${field}] ${result.error}`);
    }
  }

  return validResult();
};

// ============================================================================
// OUTLINE PARENT VALIDATORS
// ============================================================================

export const validateOutlineParentExists: Validator = async (args, toolName, context) => {
  if (toolName !== 'create_outline_act') {
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

export const validateActParentExists: Validator = async (args, toolName, context) => {
  if (toolName !== 'create_outline_chapter') {
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

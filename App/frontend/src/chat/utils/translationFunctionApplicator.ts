/**
 * Translation Function Applicator
 *
 * Handles applying translation function call results.
 * - Set functions: Full translation (new or replace existing)
 * - Patch functions: Search-replace edits for minor corrections
 */

import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { FunctionCallMetadata } from '../../llm/requestTypes';
import type { PatchRetryContext, Replacement } from '../../types/patchTypes';
import { applyPatch } from '../../utils/patchUtils';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';
import { translationService } from '../../api/unifiedObjectService';
import {
  SET_FUNCTION_NAMES,
  PATCH_FUNCTION_NAMES,
} from '../../llm/schemas/translationFunctions';

export interface TranslationApplicationResult {
  success: boolean;
  message: string;
  error?: string;
  objectId?: string;
  objectType?: string;
  data?: Record<string, any>;
  retryContexts?: PatchRetryContext[];
}

// Object type mapping for set/patch functions
const OBJECT_TYPE_MAP: Record<string, ObjectType> = {
  character: 'character',
  organization: 'organization',
  location: 'location',
  lorebook: 'lorebook',
  act: 'act',
  chapter: 'chapter',
};

/**
 * Apply translation function calls
 */
export async function applyTranslationFunctionCalls(
  functionCalls: FunctionCallMetadata[],
  targetLanguage: string
): Promise<TranslationApplicationResult[]> {
  const results: TranslationApplicationResult[] = [];

  for (const functionCall of functionCalls) {
    const functionName = functionCall.function_name || 'unknown';
    try {
      const result = await applyTranslationFunctionCall(functionCall, targetLanguage);
      results.push(result);
    } catch (error) {
      console.error('Translation function application error:', error);
      results.push({
        success: false,
        message: `Failed to apply ${functionName}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

/**
 * Apply a single translation function call
 */
async function applyTranslationFunctionCall(
  functionCall: FunctionCallMetadata,
  targetLanguage: string
): Promise<TranslationApplicationResult> {
  const functionName = functionCall.function_name || 'unknown';
  const store = useUnifiedObjectStore.getState();
  let args: any;

  // Parse arguments
  try {
    const rawArgs = functionCall.arguments ?? (functionCall as any).function_arguments;
    args = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs;
  } catch {
    return {
      success: false,
      message: `Invalid ${functionName} arguments`,
      error: 'Failed to parse function arguments',
    };
  }

  // Route to appropriate handler
  switch (functionName) {
    // ==================== Set ====================
    case 'set_basic_info_translation':
      return await handleSetBasicInfo(args, store, targetLanguage);

    case 'set_object_translation':
      return await handleSetObject(args, store, targetLanguage);

    case 'set_chapter_translation':
      return await handleSetChapter(args, store, targetLanguage);

    case 'set_manuscript_translation':
      return await handleSetManuscript(args, store, targetLanguage);

    // ==================== Patch ====================
    case 'patch_basic_info_translation':
      return await handlePatchBasicInfo(args, store, targetLanguage);

    case 'patch_object_translation':
      return await handlePatchObject(args, store, targetLanguage);

    case 'patch_chapter_translation':
      return await handlePatchChapter(args, store, targetLanguage);

    case 'patch_manuscript_translation':
      return await handlePatchManuscript(args, store, targetLanguage);

    default:
      return {
        success: false,
        message: `Unknown function: ${functionName}`,
        error: `Function ${functionName} is not supported`,
      };
  }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function getObjectData(object: UnifiedObject, language: string): Record<string, any> {
  const data = object.data[language];
  if (data) return data;
  return {};
}

async function saveTranslation(
  objectType: ObjectType,
  objectId: string,
  language: string,
  data: Record<string, any>,
  store: any
): Promise<void> {
  const result = await translationService.addTranslations([
    { objectType, objectId, language, data },
  ]);

  // Update store with returned objects
  if (result.objects?.length) {
    result.objects.forEach((obj: UnifiedObject) => {
      store.objects[obj.id] = obj;
    });
    useUnifiedObjectStore.setState({ objects: { ...store.objects } });
  }
}

// ============================================
// SET HANDLERS
// ============================================

async function handleSetBasicInfo(
  args: { id: string; title: string; logline: string; genre: string },
  store: any,
  targetLanguage: string
): Promise<TranslationApplicationResult> {
  if (!args.id) {
    return { success: false, message: 'Missing id', error: 'Required field missing' };
  }

  const data = {
    title: args.title ?? '',
    logline: args.logline ?? '',
    genre: args.genre ?? '',
  };

  await saveTranslation('basic_info', args.id, targetLanguage, data, store);

  return {
    success: true,
    message: 'Basic info translation set successfully',
    objectId: args.id,
    objectType: 'basic_info',
    data,
  };
}

async function handleSetObject(
  args: { id: string; type: string; name: string; description: string },
  store: any,
  targetLanguage: string
): Promise<TranslationApplicationResult> {
  if (!args.id || !args.type) {
    return { success: false, message: 'Missing id or type', error: 'Required fields missing' };
  }

  const objectType = OBJECT_TYPE_MAP[args.type];
  if (!objectType) {
    return { success: false, message: `Unknown type: ${args.type}`, error: 'Invalid object type' };
  }

  const data = {
    name: args.name ?? '',
    description: args.description ?? '',
  };

  await saveTranslation(objectType, args.id, targetLanguage, data, store);

  return {
    success: true,
    message: `${args.type} translation set successfully`,
    objectId: args.id,
    objectType: args.type,
    data,
  };
}

async function handleSetChapter(
  args: { id: string; type: string; name: string; description: string },
  store: any,
  targetLanguage: string
): Promise<TranslationApplicationResult> {
  if (!args.id || !args.type) {
    return { success: false, message: 'Missing id or type', error: 'Required fields missing' };
  }

  const objectType = args.type === 'act' ? 'act' : 'chapter';

  const data = {
    name: args.name ?? '',
    description: args.description ?? '',
  };

  await saveTranslation(objectType as ObjectType, args.id, targetLanguage, data, store);

  return {
    success: true,
    message: `${args.type} translation set successfully`,
    objectId: args.id,
    objectType: args.type,
    data,
  };
}

async function handleSetManuscript(
  args: { id: string; content: string },
  store: any,
  targetLanguage: string
): Promise<TranslationApplicationResult> {
  if (!args.id) {
    return { success: false, message: 'Missing id', error: 'Required field missing' };
  }

  const wordCount = (args.content ?? '').trim().split(/\s+/).filter(Boolean).length;

  const data = {
    content: args.content ?? '',
    wordCount,
  };

  await saveTranslation('manuscript', args.id, targetLanguage, data, store);

  return {
    success: true,
    message: 'Manuscript translation set successfully',
    objectId: args.id,
    objectType: 'manuscript',
    data,
  };
}

// ============================================
// PATCH HANDLERS
// ============================================

async function handlePatchBasicInfo(
  args: { id: string; replacements: Replacement[] },
  store: any,
  targetLanguage: string
): Promise<TranslationApplicationResult> {
  if (!args.id || !args.replacements || !Array.isArray(args.replacements)) {
    return { success: false, message: 'Missing id or replacements', error: 'Required fields missing' };
  }

  const object = store.objects[args.id];
  if (!object) {
    return { success: false, message: 'Object not found', error: `Object with id ${args.id} not found` };
  }

  const currentData = getObjectData(object, targetLanguage);
  const retryContexts: PatchRetryContext[] = [];

  const newData: Record<string, string> = {
    title: currentData.title ?? '',
    logline: currentData.logline ?? '',
    genre: currentData.genre ?? '',
  };

  for (const r of args.replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) continue;

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
    } else {
      retryContexts.push({
        objectId: args.id,
        fieldName: r.field,
        currentValue: newData[r.field],
        error: result.error || 'Patch failed',
      });
    }
  }

  await saveTranslation('basic_info', args.id, targetLanguage, newData, store);

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? 'Basic info translation patched successfully'
      : `Basic info translation patched with ${retryContexts.length} failure(s)`,
    objectId: args.id,
    objectType: 'basic_info',
    data: newData,
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

async function handlePatchObject(
  args: { id: string; type: string; replacements: Replacement[] },
  store: any,
  targetLanguage: string
): Promise<TranslationApplicationResult> {
  if (!args.id || !args.type || !args.replacements) {
    return { success: false, message: 'Missing required fields', error: 'Required fields missing' };
  }

  const objectType = OBJECT_TYPE_MAP[args.type];
  if (!objectType) {
    return { success: false, message: `Unknown type: ${args.type}`, error: 'Invalid object type' };
  }

  const object = store.objects[args.id];
  if (!object) {
    return { success: false, message: 'Object not found', error: `Object with id ${args.id} not found` };
  }

  const currentData = getObjectData(object, targetLanguage);
  const retryContexts: PatchRetryContext[] = [];

  const newData: Record<string, string> = {
    name: currentData.name ?? '',
    description: currentData.description ?? '',
  };

  for (const r of args.replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) continue;

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
    } else {
      retryContexts.push({
        objectId: args.id,
        objectType: args.type,
        fieldName: r.field,
        currentValue: newData[r.field],
        error: result.error || 'Patch failed',
      });
    }
  }

  await saveTranslation(objectType, args.id, targetLanguage, newData, store);

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? `${args.type} translation patched successfully`
      : `${args.type} translation patched with ${retryContexts.length} failure(s)`,
    objectId: args.id,
    objectType: args.type,
    data: newData,
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

async function handlePatchChapter(
  args: { id: string; type: string; replacements: Replacement[] },
  store: any,
  targetLanguage: string
): Promise<TranslationApplicationResult> {
  if (!args.id || !args.type || !args.replacements) {
    return { success: false, message: 'Missing required fields', error: 'Required fields missing' };
  }

  const objectType = args.type === 'act' ? 'act' : 'chapter';

  const object = store.objects[args.id];
  if (!object) {
    return { success: false, message: 'Object not found', error: `Object with id ${args.id} not found` };
  }

  const currentData = getObjectData(object, targetLanguage);
  const retryContexts: PatchRetryContext[] = [];

  const newData: Record<string, string> = {
    name: currentData.name ?? '',
    description: currentData.description ?? '',
  };

  for (const r of args.replacements) {
    if (!r.field || !Object.prototype.hasOwnProperty.call(newData, r.field)) continue;

    const result = applyPatch(newData[r.field], [{ old: r.old, new: r.new }]);
    if (result.success) {
      newData[r.field] = result.value;
    } else {
      retryContexts.push({
        objectId: args.id,
        objectType: args.type,
        fieldName: r.field,
        currentValue: newData[r.field],
        error: result.error || 'Patch failed',
      });
    }
  }

  await saveTranslation(objectType as ObjectType, args.id, targetLanguage, newData, store);

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? `${args.type} translation patched successfully`
      : `${args.type} translation patched with ${retryContexts.length} failure(s)`,
    objectId: args.id,
    objectType: args.type,
    data: newData,
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

async function handlePatchManuscript(
  args: { id: string; replacements: Array<{ old: string; new: string }> },
  store: any,
  targetLanguage: string
): Promise<TranslationApplicationResult> {
  if (!args.id || !args.replacements) {
    return { success: false, message: 'Missing required fields', error: 'Required fields missing' };
  }

  const object = store.objects[args.id];
  if (!object) {
    return { success: false, message: 'Manuscript not found', error: `Manuscript with id ${args.id} not found` };
  }

  const currentData = getObjectData(object, targetLanguage);
  const currentContent = currentData.content ?? '';
  const retryContexts: PatchRetryContext[] = [];

  const result = applyPatch(currentContent, args.replacements);

  if (!result.success) {
    retryContexts.push({
      objectId: args.id,
      fieldName: 'content',
      currentValue: currentContent,
      error: result.error || 'Patch failed',
    });
  }

  const wordCount = result.value.trim().split(/\s+/).filter(Boolean).length;

  await saveTranslation('manuscript', args.id, targetLanguage, { content: result.value, wordCount }, store);

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? 'Manuscript translation patched successfully'
      : 'Manuscript translation patched with failure(s)',
    objectId: args.id,
    objectType: 'manuscript',
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

/**
 * Check if a function name is a translation function
 */
export function isTranslationFunction(functionName: string): boolean {
  return SET_FUNCTION_NAMES.has(functionName) || PATCH_FUNCTION_NAMES.has(functionName);
}

/**
 * Check if a function name is a set function
 */
export function isSetFunction(functionName: string): boolean {
  return SET_FUNCTION_NAMES.has(functionName);
}

/**
 * Check if a function name is a patch function
 */
export function isPatchFunction(functionName: string): boolean {
  return PATCH_FUNCTION_NAMES.has(functionName);
}

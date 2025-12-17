/**
 * Edit Function Applicator - Unified System
 *
 * Handles applying edit function call results to the unified object store.
 * Supports the new replace/patch function structure:
 * - Replace: Full field replacement
 * - Patch: Search and replace within fields
 */

import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { FunctionCallMetadata } from '../../llm/requestTypes';
import type { PatchRetryContext, Replacement, StoryObjectType } from '../../types/patchTypes';
import { applyPatch } from '../../utils/patchUtils';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';

export interface FunctionApplicationResult {
  success: boolean;
  message: string;
  error?: string;
  data?: unknown;
  /** Contexts for fields that need retry (patch failed) */
  retryContexts?: PatchRetryContext[];
}

/** Maps story object type to unified object type */
const STORY_OBJECT_TYPE_MAP: Record<StoryObjectType, ObjectType> = {
  character: 'character',
  location: 'location',
  item: 'lorebook',
  event: 'lorebook',
  act: 'act',
  other: 'lorebook',
};

/**
 * Apply edit function calls to the unified store
 */
export async function applyEditFunctionCalls(
  projectId: string,
  functionCalls: FunctionCallMetadata[]
): Promise<FunctionApplicationResult[]> {
  const results: FunctionApplicationResult[] = [];

  for (const functionCall of functionCalls) {
    const functionName = functionCall.function_name || (functionCall as any).name || 'unknown';
    try {
      const result = await applyEditFunctionCall(projectId, functionCall);
      results.push(result);
    } catch (error) {
      console.error('Function application error:', error);
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
 * Apply a single edit function call
 */
async function applyEditFunctionCall(
  projectId: string,
  functionCall: FunctionCallMetadata
): Promise<FunctionApplicationResult> {
  const functionName = functionCall.function_name || (functionCall as any).name || 'unknown';
  const store = useUnifiedObjectStore.getState();
  const settings = useSettingsStore.getState();
  const language = settings.settings.mainLanguage;
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
    // ==================== Replace ====================
    case 'replace_basic_info':
      return await handleReplaceBasicInfo(projectId, args, store, language);

    case 'replace_story_object':
      return await handleReplaceStoryObject(args, store, language);

    case 'replace_chapter':
      return await handleReplaceChapter(args, store, language);

    case 'replace_manuscript':
      return await handleReplaceManuscript(projectId, args, store, language);

    // ==================== Patch ====================
    case 'patch_basic_info':
      return await handlePatchBasicInfo(projectId, args, store, language);

    case 'patch_story_object':
      return await handlePatchStoryObject(args, store, language);

    case 'patch_chapter':
      return await handlePatchChapter(args, store, language);

    case 'patch_manuscript':
      return await handlePatchManuscript(projectId, args, store, language);

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
  const availableLanguages = Object.keys(object.data);
  if (availableLanguages.length > 0) {
    return object.data[availableLanguages[0]];
  }
  return {};
}

// ============================================
// REPLACE HANDLERS
// ============================================

async function handleReplaceBasicInfo(
  projectId: string,
  args: { title?: string; logline?: string; genre?: string },
  store: any,
  language: string
): Promise<FunctionApplicationResult> {
  const basicInfoList = await store.listObjects('basic_info', projectId);

  if (basicInfoList.length > 0) {
    const basicInfo = basicInfoList[0];
    const currentData = getObjectData(basicInfo, language);

    await store.updateObject('basic_info', basicInfo.id, {
      data: {
        title: args.title ?? currentData.title ?? '',
        logline: args.logline ?? currentData.logline ?? '',
        genre: args.genre ?? currentData.genre ?? '',
      },
      language,
      create_new_version: true,
      user_request: 'AI Edit',
    });

    return {
      success: true,
      message: 'Basic info updated successfully',
      data: { title: args.title, logline: args.logline, genre: args.genre },
    };
  }

  // Create new basic info
  await store.createObject(
    'basic_info',
    projectId,
    {
      title: args.title ?? '',
      logline: args.logline ?? '',
      genre: args.genre ?? '',
    },
    language
  );

  return {
    success: true,
    message: 'Basic info created successfully',
    data: { title: args.title, logline: args.logline, genre: args.genre },
  };
}

async function handleReplaceStoryObject(
  args: { id: string; type: StoryObjectType; name?: string; description?: string },
  store: any,
  language: string
): Promise<FunctionApplicationResult> {
  if (!args.id || !args.type) {
    return { success: false, message: 'Missing id or type', error: 'Required fields missing' };
  }

  const objectType = STORY_OBJECT_TYPE_MAP[args.type];
  if (!objectType) {
    return { success: false, message: `Unknown type: ${args.type}`, error: 'Invalid story object type' };
  }

  const object = store.objects[args.id];
  if (!object) {
    return { success: false, message: 'Object not found', error: `Object with id ${args.id} not found` };
  }

  const currentData = getObjectData(object, language);

  await store.updateObject(objectType, args.id, {
    data: {
      name: args.name ?? currentData.name ?? '',
      description: args.description ?? currentData.description ?? '',
    },
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: true,
    message: `${args.type} updated successfully`,
    data: { id: args.id, name: args.name, description: args.description },
  };
}

async function handleReplaceChapter(
  args: { id: string; actId?: string; name?: string; description?: string },
  store: any,
  language: string
): Promise<FunctionApplicationResult> {
  if (!args.id) {
    return { success: false, message: 'Missing id', error: 'Required field missing' };
  }

  const chapter = store.objects[args.id];
  if (!chapter) {
    return { success: false, message: 'Chapter not found', error: `Chapter with id ${args.id} not found` };
  }

  const currentData = getObjectData(chapter, language);

  await store.updateObject('chapter', args.id, {
    data: {
      name: args.name ?? currentData.name ?? '',
      description: args.description ?? currentData.description ?? '',
    },
    language,
    create_new_version: true,
    user_request: 'AI Edit',
    ...(args.actId && { metadata: { act_id: args.actId } }),
  });

  return {
    success: true,
    message: 'Chapter updated successfully',
    data: { id: args.id, name: args.name, description: args.description },
  };
}

async function handleReplaceManuscript(
  projectId: string,
  args: { chapterId: string; content: string },
  store: any,
  language: string
): Promise<FunctionApplicationResult> {
  if (!args.chapterId || args.content === undefined) {
    return { success: false, message: 'Missing chapterId or content', error: 'Required fields missing' };
  }

  const manuscripts = await store.listObjects('manuscript', projectId);
  let manuscript = manuscripts.find((m: UnifiedObject) => m.metadata?.chapter_id === args.chapterId);

  if (!manuscript) {
    manuscript = await store.createObject(
      'manuscript',
      projectId,
      { content: '', wordCount: 0 },
      language,
      { chapter_id: args.chapterId }
    );
  }

  const wordCount = args.content.trim().split(/\s+/).filter(Boolean).length;

  await store.updateObject('manuscript', manuscript.id, {
    data: { content: args.content, wordCount },
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: true,
    message: 'Manuscript updated successfully',
  };
}

// ============================================
// PATCH HANDLERS
// ============================================

async function handlePatchBasicInfo(
  projectId: string,
  args: { replacements: Replacement[] },
  store: any,
  language: string
): Promise<FunctionApplicationResult> {
  if (!args.replacements || !Array.isArray(args.replacements)) {
    return { success: false, message: 'Missing replacements', error: 'Required field missing' };
  }

  const basicInfoList = await store.listObjects('basic_info', projectId);
  if (basicInfoList.length === 0) {
    return { success: false, message: 'No basic info found', error: 'Basic info not found' };
  }

  const basicInfo = basicInfoList[0];
  const currentData = getObjectData(basicInfo, language);
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
        objectId: basicInfo.id,
        fieldName: r.field,
        currentValue: newData[r.field],
        error: result.error || 'Patch failed',
      });
    }
  }

  await store.updateObject('basic_info', basicInfo.id, {
    data: newData,
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? 'Basic info updated successfully'
      : `Basic info updated with ${retryContexts.length} patch failure(s)`,
    data: newData,
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

async function handlePatchStoryObject(
  args: { id: string; type: StoryObjectType; replacements: Replacement[] },
  store: any,
  language: string
): Promise<FunctionApplicationResult> {
  if (!args.id || !args.type || !args.replacements) {
    return { success: false, message: 'Missing required fields', error: 'Required fields missing' };
  }

  const objectType = STORY_OBJECT_TYPE_MAP[args.type];
  if (!objectType) {
    return { success: false, message: `Unknown type: ${args.type}`, error: 'Invalid story object type' };
  }

  const object = store.objects[args.id];
  if (!object) {
    return { success: false, message: 'Object not found', error: `Object with id ${args.id} not found` };
  }

  const currentData = getObjectData(object, language);
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

  await store.updateObject(objectType, args.id, {
    data: newData,
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? `${args.type} updated successfully`
      : `${args.type} updated with ${retryContexts.length} patch failure(s)`,
    data: { id: args.id, ...newData },
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

async function handlePatchChapter(
  args: { id: string; replacements: Replacement[] },
  store: any,
  language: string
): Promise<FunctionApplicationResult> {
  if (!args.id || !args.replacements) {
    return { success: false, message: 'Missing required fields', error: 'Required fields missing' };
  }

  const chapter = store.objects[args.id];
  if (!chapter) {
    return { success: false, message: 'Chapter not found', error: `Chapter with id ${args.id} not found` };
  }

  const currentData = getObjectData(chapter, language);
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
        objectType: 'chapter',
        fieldName: r.field,
        currentValue: newData[r.field],
        error: result.error || 'Patch failed',
      });
    }
  }

  await store.updateObject('chapter', args.id, {
    data: newData,
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? 'Chapter updated successfully'
      : `Chapter updated with ${retryContexts.length} patch failure(s)`,
    data: { id: args.id, ...newData },
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}

async function handlePatchManuscript(
  projectId: string,
  args: { chapterId: string; replacements: Array<{ old: string; new: string }> },
  store: any,
  language: string
): Promise<FunctionApplicationResult> {
  if (!args.chapterId || !args.replacements) {
    return { success: false, message: 'Missing required fields', error: 'Required fields missing' };
  }

  const manuscripts = await store.listObjects('manuscript', projectId);
  const manuscript = manuscripts.find((m: UnifiedObject) => m.metadata?.chapter_id === args.chapterId);

  if (!manuscript) {
    return { success: false, message: 'Manuscript not found', error: `No manuscript for chapter ${args.chapterId}` };
  }

  const currentData = getObjectData(manuscript, language);
  const currentContent = currentData.content ?? '';
  const retryContexts: PatchRetryContext[] = [];

  const result = applyPatch(currentContent, args.replacements);

  if (!result.success) {
    retryContexts.push({
      objectId: manuscript.id,
      fieldName: 'content',
      currentValue: currentContent,
      error: result.error || 'Patch failed',
    });
  }

  const wordCount = result.value.trim().split(/\s+/).filter(Boolean).length;

  await store.updateObject('manuscript', manuscript.id, {
    data: { content: result.value, wordCount },
    language,
    create_new_version: true,
    user_request: 'AI Edit',
  });

  return {
    success: retryContexts.length === 0,
    message: retryContexts.length === 0
      ? 'Manuscript updated successfully'
      : 'Manuscript updated with patch failure(s)',
    retryContexts: retryContexts.length > 0 ? retryContexts : undefined,
  };
}


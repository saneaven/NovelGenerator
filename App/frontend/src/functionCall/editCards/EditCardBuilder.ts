/**
 * EditCard Builder
 *
 * Builds EditCard objects from function calls for UI display.
 */

import type { EditCard, FunctionCallWithStatus, RawFunctionCall, NormalizedFunctionCall } from '../types';
import { normalizeFunctionCall, validateFunctionCall } from '../normalizer';

// ============================================================================
// EDIT TYPES
// ============================================================================

type EditType = 'add' | 'edit' | 'remove' | 'init' | 'translate';

// ============================================================================
// FUNCTION METADATA
// ============================================================================

interface FunctionMeta {
  editType: EditType;
  title: string;
  description: string;
  summary?: (args: Record<string, unknown>) => string;
}

/**
 * Metadata for all function calls
 */
const FUNCTION_META: Record<string, FunctionMeta> = {
  // CRUD
  create_story_object: {
    editType: 'add',
    title: 'Create Object',
    description: 'Create a story object',
    summary: (args) => {
      const type = args.type as string;
      const name = args.name as string;
      return `${type}: ${name}`;
    },
  },
  delete_story_object: {
    editType: 'remove',
    title: 'Delete Object',
    description: 'Delete a story object',
    summary: (args) => `${args.type}: ${args.id}`,
  },
  create_chapter: {
    editType: 'add',
    title: 'Create Chapter',
    description: 'Create a chapter',
    summary: (args) => args.name as string,
  },
  delete_chapter: {
    editType: 'remove',
    title: 'Delete Chapter',
    description: 'Delete a chapter',
    summary: (args) => args.id as string,
  },

  // Replace
  replace_basic_info: {
    editType: 'edit',
    title: 'Update Basic Info',
    description: 'Replace basic info fields',
    summary: (args) => {
      const fields = ['title', 'logline', 'genre'].filter(f => args[f]);
      return fields.length > 0 ? fields.join(', ') : 'basic info';
    },
  },
  replace_story_object: {
    editType: 'edit',
    title: 'Update Object',
    description: 'Replace story object fields',
    summary: (args) => `${args.type}: ${args.name || args.id}`,
  },
  replace_chapter_outline: {
    editType: 'edit',
    title: 'Update Chapter Outline',
    description: 'Replace chapter outline fields',
    summary: (args) => args.name as string || args.id as string,
  },
  replace_manuscript: {
    editType: 'edit',
    title: 'Update Manuscript',
    description: 'Replace manuscript content',
    summary: (args) => {
      const content = args.content as string;
      const words = content?.trim().split(/\s+/).length ?? 0;
      return `${words} words`;
    },
  },

  // Patch
  patch_basic_info: {
    editType: 'edit',
    title: 'Patch Basic Info',
    description: 'Search-replace in basic info',
    summary: (args) => {
      const replacements = args.replacements as unknown[];
      return `${replacements?.length ?? 0} replacements`;
    },
  },
  patch_story_object: {
    editType: 'edit',
    title: 'Patch Object',
    description: 'Search-replace in story object',
    summary: (args) => {
      const type = args.type as string;
      const replacements = args.replacements as unknown[];
      return `${type}: ${replacements?.length ?? 0} replacements`;
    },
  },
  patch_chapter_outline: {
    editType: 'edit',
    title: 'Patch Chapter Outline',
    description: 'Search-replace in chapter outline',
    summary: (args) => {
      const replacements = args.replacements as unknown[];
      return `${replacements?.length ?? 0} replacements`;
    },
  },
  patch_manuscript: {
    editType: 'edit',
    title: 'Patch Manuscript',
    description: 'Search-replace in manuscript',
    summary: (args) => {
      const replacements = args.replacements as unknown[];
      return `${replacements?.length ?? 0} replacements`;
    },
  },

  // Translation Set
  set_basic_info_translation: {
    editType: 'translate',
    title: 'Translate Basic Info',
    description: 'Set basic info translation',
    summary: () => 'title, logline, genre',
  },
  set_object_translation: {
    editType: 'translate',
    title: 'Translate Object',
    description: 'Set object translation',
    summary: (args) => `${args.type}: ${args.name || args.id}`,
  },
  set_chapter_translation: {
    editType: 'translate',
    title: 'Translate Chapter',
    description: 'Set chapter translation',
    summary: (args) => `${args.type}: ${args.name || args.id}`,
  },
  set_manuscript_translation: {
    editType: 'translate',
    title: 'Translate Manuscript',
    description: 'Set manuscript translation',
    summary: (args) => {
      const content = args.content as string;
      const words = content?.trim().split(/\s+/).length ?? 0;
      return `${words} words`;
    },
  },

  // Translation Patch
  patch_basic_info_translation: {
    editType: 'translate',
    title: 'Patch Basic Info Translation',
    description: 'Patch basic info translation',
    summary: (args) => {
      const replacements = args.replacements as unknown[];
      return `${replacements?.length ?? 0} replacements`;
    },
  },
  patch_object_translation: {
    editType: 'translate',
    title: 'Patch Object Translation',
    description: 'Patch object translation',
    summary: (args) => {
      const type = args.type as string;
      const replacements = args.replacements as unknown[];
      return `${type}: ${replacements?.length ?? 0} replacements`;
    },
  },
  patch_chapter_translation: {
    editType: 'translate',
    title: 'Patch Chapter Translation',
    description: 'Patch chapter translation',
    summary: (args) => {
      const type = args.type as string;
      const replacements = args.replacements as unknown[];
      return `${type}: ${replacements?.length ?? 0} replacements`;
    },
  },
  patch_manuscript_translation: {
    editType: 'translate',
    title: 'Patch Manuscript Translation',
    description: 'Patch manuscript translation',
    summary: (args) => {
      const replacements = args.replacements as unknown[];
      return `${replacements?.length ?? 0} replacements`;
    },
  },

  // Chat message translation
  set_chat_message_translation: {
    editType: 'translate',
    title: 'Translate Message',
    description: 'Translate chat message',
    summary: () => 'message content',
  },
};

// ============================================================================
// BUILDER FUNCTIONS
// ============================================================================

/**
 * Get edit type for a function
 */
export function getEditType(functionName: string): EditType {
  return FUNCTION_META[functionName]?.editType ?? 'edit';
}

/**
 * Get display title for a function
 */
export function getFunctionTitle(functionName: string): string {
  return FUNCTION_META[functionName]?.title ?? `Function: ${functionName}`;
}

/**
 * Get display description for a function
 */
export function getFunctionDescription(functionName: string): string {
  return FUNCTION_META[functionName]?.description ?? 'Function call';
}

/**
 * Get display name for a function (same as title)
 */
export function getFunctionDisplayName(functionName: string): string {
  return getFunctionTitle(functionName);
}

/**
 * Generate summary for a function call
 */
export function generateFunctionSummary(
  functionName: string,
  args: Record<string, unknown>
): string {
  const meta = FUNCTION_META[functionName];
  if (!meta) return 'Function call';

  const summary = meta.summary ? meta.summary(args) : undefined;
  return summary ? `${meta.description}: ${summary}` : meta.description;
}

/**
 * Build an EditCard from a function call
 */
export function buildEditCard(
  functionCall: RawFunctionCall | NormalizedFunctionCall,
  options?: {
    onApply?: () => void;
    onReject?: () => void;
  }
): EditCard {
  // Normalize if needed
  const normalized = 'functionName' in functionCall
    ? functionCall as NormalizedFunctionCall
    : normalizeFunctionCall(functionCall as RawFunctionCall);

  // Validate
  const validation = validateFunctionCall(normalized.functionName, normalized.arguments);

  // Build function call with status
  const functionCallWithStatus: FunctionCallWithStatus = {
    id: normalized.id,
    functionName: normalized.functionName,
    arguments: normalized.arguments,
    isApplied: false,
    isRejected: false,
  };

  return {
    id: normalized.id,
    type: getEditType(normalized.functionName),
    title: getFunctionTitle(normalized.functionName),
    description: generateFunctionSummary(normalized.functionName, normalized.arguments),
    isApplied: false,
    isRejected: false,
    data: normalized.arguments,
    functionCall: functionCallWithStatus,
    onApply: options?.onApply,
    onReject: options?.onReject,
    validationError: validation.valid ? undefined : validation.errors?.join(', '),
  };
}

/**
 * Build multiple EditCards from function calls
 */
export function buildEditCards(
  functionCalls: Array<RawFunctionCall | NormalizedFunctionCall>,
  options?: {
    createApplyHandler?: (functionCall: NormalizedFunctionCall) => () => void;
    createRejectHandler?: (functionCall: NormalizedFunctionCall) => () => void;
  }
): EditCard[] {
  return functionCalls.map(fc => {
    const normalized = 'functionName' in fc
      ? fc as NormalizedFunctionCall
      : normalizeFunctionCall(fc as RawFunctionCall);

    return buildEditCard(fc, {
      onApply: options?.createApplyHandler?.(normalized),
      onReject: options?.createRejectHandler?.(normalized),
    });
  });
}

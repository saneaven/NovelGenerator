/**
 * EditCard Builder
 *
 * Builds EditCard objects from function calls for UI display.
 */

import type {
  EditCard,
  FunctionCallWithStatus,
  RawFunctionCall,
  NormalizedFunctionCall,
  FunctionCallStatus,
} from '../types';
import { normalizeFunctionCall, validateFunctionCall } from '../normalizer';
import type { ValidationResult } from '../validation';
import type { FunctionCallMetadata } from '../../llm/requestTypes';

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
  patch_manuscript: {
    editType: 'edit',
    title: 'Patch Manuscript',
    description: 'Search-replace in manuscript',
    summary: (args) => {
      const replacements = args.replacements as unknown[];
      return `${replacements?.length ?? 0} replacements`;
    },
  },

  // Outline CRUD
  create_outline: {
    editType: 'add',
    title: 'Create Outline',
    description: 'Create an outline',
    summary: (args) => args.name as string,
  },
  delete_outline: {
    editType: 'remove',
    title: 'Delete Outline',
    description: 'Delete an outline',
    summary: (args) => args.id as string,
  },
  create_outline_act: {
    editType: 'add',
    title: 'Create Act',
    description: 'Create an act',
    summary: (args) => args.name as string,
  },
  delete_outline_act: {
    editType: 'remove',
    title: 'Delete Act',
    description: 'Delete an act',
    summary: (args) => args.id as string,
  },
  create_outline_chapter: {
    editType: 'add',
    title: 'Create Chapter',
    description: 'Create a chapter in outline',
    summary: (args) => args.name as string,
  },
  delete_outline_chapter: {
    editType: 'remove',
    title: 'Delete Chapter',
    description: 'Delete a chapter from outline',
    summary: (args) => args.id as string,
  },

  // Outline Replace
  replace_outline: {
    editType: 'edit',
    title: 'Update Outline',
    description: 'Replace outline fields',
    summary: (args) => args.name as string || args.id as string,
  },
  replace_outline_act: {
    editType: 'edit',
    title: 'Update Act',
    description: 'Replace act fields',
    summary: (args) => args.name as string || args.id as string,
  },
  replace_outline_chapter: {
    editType: 'edit',
    title: 'Update Chapter',
    description: 'Replace chapter fields',
    summary: (args) => args.name as string || args.id as string,
  },

  // Outline Patch
  patch_outline: {
    editType: 'edit',
    title: 'Patch Outline',
    description: 'Search-replace in outline',
    summary: (args) => {
      const replacements = args.replacements as unknown[];
      return `${replacements?.length ?? 0} replacements`;
    },
  },
  patch_outline_act: {
    editType: 'edit',
    title: 'Patch Act',
    description: 'Search-replace in act',
    summary: (args) => {
      const replacements = args.replacements as unknown[];
      return `${replacements?.length ?? 0} replacements`;
    },
  },
  patch_outline_chapter: {
    editType: 'edit',
    title: 'Patch Chapter',
    description: 'Search-replace in chapter',
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
  set_chapter_outline_translation: {
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
  patch_chapter_outline_translation: {
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

  // Agent message translation
  set_message_translation: {
    editType: 'translate',
    title: 'Translate Message',
    description: 'Translate agent message',
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
 * Options for building an EditCard
 */
export interface BuildEditCardOptions {
  /** Handler called when user clicks Apply */
  onApply?: () => void;
  /** Handler called when user clicks Reject */
  onReject?: (reason?: string) => void;
  /** Initial status (defaults to running schema validation) */
  initialStatus?: FunctionCallStatus;
  /** Validation result (overrides schema validation) */
  validationResult?: ValidationResult;
}

/**
 * Build an EditCard from a function call
 */
export function buildEditCard(
  functionCall: RawFunctionCall | NormalizedFunctionCall,
  options?: BuildEditCardOptions
): EditCard {
  // Normalize if needed
  const normalized = 'functionName' in functionCall
    ? functionCall as NormalizedFunctionCall
    : normalizeFunctionCall(functionCall as RawFunctionCall);

  // Determine status
  let status: FunctionCallStatus;
  let reason: string | undefined;

  if (options?.initialStatus) {
    // Use provided initial status (e.g., 'validating')
    status = options.initialStatus;
    reason = undefined;
  } else if (options?.validationResult) {
    // Use provided validation result
    status = options.validationResult.valid ? 'pending' : 'failed';
    reason = options.validationResult.error;
  } else {
    // Fall back to schema validation
    const validation = validateFunctionCall(normalized.functionName, normalized.arguments);
    status = validation.valid ? 'pending' : 'failed';
    reason = validation.valid ? undefined : validation.errors?.join(', ');
  }

  // Build function call with status
  const functionCallWithStatus: FunctionCallWithStatus = {
    id: normalized.id,
    functionName: normalized.functionName,
    arguments: normalized.arguments,
    status,
    reason,
    failureType: status === 'failed' ? 'validation' : undefined,
  };

  return {
    id: normalized.id,
    type: getEditType(normalized.functionName),
    title: getFunctionTitle(normalized.functionName),
    description: generateFunctionSummary(normalized.functionName, normalized.arguments),
    data: normalized.arguments,
    functionCall: functionCallWithStatus,
    onApply: options?.onApply,
    onReject: options?.onReject,
  };
}

/**
 * Options for building multiple EditCards
 */
export interface BuildEditCardsOptions {
  /** Factory for Apply handlers */
  createApplyHandler?: (functionCall: NormalizedFunctionCall) => () => void;
  /** Factory for Reject handlers */
  createRejectHandler?: (functionCall: NormalizedFunctionCall) => () => void;
  /** Initial status for all cards (e.g., 'validating') */
  initialStatus?: FunctionCallStatus;
  /** Validation results map (keyed by function call ID) */
  validationResults?: Map<string, ValidationResult>;
}

/**
 * Build multiple EditCards from function calls
 */
export function buildEditCards(
  functionCalls: Array<RawFunctionCall | NormalizedFunctionCall>,
  options?: BuildEditCardsOptions
): EditCard[] {
  return functionCalls.map(fc => {
    const normalized = 'functionName' in fc
      ? fc as NormalizedFunctionCall
      : normalizeFunctionCall(fc as RawFunctionCall);

    return buildEditCard(fc, {
      onApply: options?.createApplyHandler?.(normalized),
      onReject: options?.createRejectHandler?.(normalized),
      initialStatus: options?.initialStatus,
      validationResult: options?.validationResults?.get(normalized.id),
    });
  });
}

/**
 * Update EditCards with validation results.
 * Returns new cards with updated status based on validation.
 */
export function applyValidationResults(
  cards: EditCard[],
  validationResults: Map<string, ValidationResult>
): EditCard[] {
  return cards.map(card => {
    const result = validationResults.get(card.id);
    if (!result) return card;

    const newStatus: FunctionCallStatus = result.valid ? 'pending' : 'failed';
    const newReason = result.valid ? undefined : result.error;

    return {
      ...card,
      functionCall: {
        ...card.functionCall,
        status: newStatus,
        reason: newReason,
        failureType: newStatus === 'failed' ? 'validation' : undefined,
      },
    };
  });
}

/**
 * Build EditCards from function calls already stored in chat history.
 * Preserves status/result fields instead of re-running validation.
 */
export function buildEditCardsFromFunctionCallMetadata(
  functionCalls: FunctionCallMetadata[]
): EditCard[] {
  return functionCalls.map((fc) => {
    const card = buildEditCard({
      id: fc.id,
      function_name: fc.function_name,
      arguments: fc.arguments,
    });

    const acceptedAt =
      fc.acceptedAt instanceof Date
        ? fc.acceptedAt
        : fc.acceptedAt
          ? new Date(fc.acceptedAt as any)
          : undefined;

    return {
      ...card,
      functionCall: {
        ...card.functionCall,
        status: fc.status,
        reason: fc.reason,
        failureType: fc.failureType,
        result: fc.result,
        acceptedAt,
      },
    };
  });
}

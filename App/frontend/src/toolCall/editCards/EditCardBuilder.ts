/**
 * EditCard Builder
 *
 * Builds EditCard objects from tool calls for UI display.
 */

import type {
  EditCard,
  ToolCallWithStatus,
  RawToolCall,
  NormalizedToolCall,
  ToolCallStatus,
} from '../types';
import { normalizeToolCall, validateToolCall } from '../normalizer';
import type { ValidationResult } from '../validation';
import type { ToolCallMetadata } from '../../llm/requestTypes';
import { useSubAgentStore } from '../../store/subAgentStore';
import { agentNameFromCallToolName, isCallToolName } from '../../subAgent/tools/SubAgentCallTools';

// ============================================================================
// EDIT TYPES
// ============================================================================

type EditType = 'add' | 'edit' | 'remove' | 'init' | 'translate';

// ============================================================================
// TOOL METADATA
// ============================================================================

interface ToolMeta {
  editType: EditType;
  title: string;
  description: string;
  summary?: (args: Record<string, unknown>) => string;
}

/**
 * Metadata for all tool calls
 */
const TOOL_META: Record<string, ToolMeta> = {
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
  replace_guidelines: {
    editType: 'edit',
    title: 'Update Guidelines',
    description: 'Replace guidelines author note',
    summary: (args) => (args.id as string) || 'guidelines',
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
  patch_guidelines: {
    editType: 'edit',
    title: 'Patch Guidelines',
    description: 'Search-replace in guidelines',
    summary: (args) => `${args.id}`,
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

  // Read Operations
  read_story_object: {
    editType: 'init',
    title: 'Read Object',
    description: 'Read story object content',
    summary: (args) => `${args.type}: ${args.id}`,
  },
  read_outline: {
    editType: 'init',
    title: 'Read Outline Item',
    description: 'Read outline/act/chapter content',
    summary: (args) => `${args.type}: ${args.id}`,
  },
  read_manuscript: {
    editType: 'init',
    title: 'Read Manuscript',
    description: 'Read manuscript content',
    summary: (args) => {
      const offset = args.offset as { from?: number; to?: number } | undefined;
      if (offset) {
        return `id: ${args.id} (${offset.from}-${offset.to})`;
      }
      return `id: ${args.id}`;
    },
  },
  rag_search: {
    editType: 'init',
    title: 'RAG Search',
    description: 'Search project knowledge base',
    summary: (args) => {
      const queries = (args.queries as unknown[]) ?? [];
      if (Array.isArray(queries)) {
        return `${queries.length} query(s)`;
      }
      return 'queries';
    },
  },
};

// ============================================================================
// BUILDER FUNCTIONS
// ============================================================================

/**
 * Get edit type for a tool
 */
export function getEditType(toolName: string): EditType {
  if (isCallToolName(toolName)) return 'init';
  return TOOL_META[toolName]?.editType ?? 'edit';
}

/**
 * Get display title for a tool
 */
export function getToolTitle(toolName: string): string {
  if (isCallToolName(toolName)) {
    const agentName = agentNameFromCallToolName(toolName);
    const def = agentName ? useSubAgentStore.getState().getByAgentName(agentName) : undefined;
    const label = def?.display_name ?? agentName ?? toolName;
    return `Call Sub Agent: ${label}`;
  }
  return TOOL_META[toolName]?.title ?? `Tool: ${toolName}`;
}

/**
 * Get display description for a tool
 */
export function getToolDescription(toolName: string): string {
  if (isCallToolName(toolName)) {
    const agentName = agentNameFromCallToolName(toolName);
    const def = agentName ? useSubAgentStore.getState().getByAgentName(agentName) : undefined;
    if (def?.description?.trim()) return def.description.trim();
    return 'Run a configured Sub Agent and return its full output';
  }
  return TOOL_META[toolName]?.description ?? 'Tool call';
}

/**
 * Get display name for a tool (same as title)
 */
export function getToolDisplayName(toolName: string): string {
  return getToolTitle(toolName);
}

/**
 * Generate summary for a tool call
 */
export function generateToolSummary(
  toolName: string,
  args: Record<string, unknown>
): string {
  if (isCallToolName(toolName)) {
    const agentName = agentNameFromCallToolName(toolName);
    const def = agentName ? useSubAgentStore.getState().getByAgentName(agentName) : undefined;
    const display = def?.display_name ?? agentName ?? toolName;
    const input = (args as any).input;
    const len = typeof input === 'string' ? input.length : 0;
    return `Call Sub Agent "${display}": input len ${len}`;
  }
  const meta = TOOL_META[toolName];
  if (!meta) return 'Tool call';

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
  initialStatus?: ToolCallStatus;
  /** Validation result (overrides schema validation) */
  validationResult?: ValidationResult;
}

/**
 * Build an EditCard from a tool call
 */
export function buildEditCard(
  toolCall: RawToolCall | NormalizedToolCall,
  options?: BuildEditCardOptions
): EditCard {
  // Normalize if needed
  const normalized = 'toolName' in toolCall
    ? toolCall as NormalizedToolCall
    : normalizeToolCall(toolCall as RawToolCall);

  // Determine status
  let status: ToolCallStatus;
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
    const validation = validateToolCall(normalized.toolName, normalized.arguments);
    status = validation.valid ? 'pending' : 'failed';
    reason = validation.valid ? undefined : validation.errors?.join(', ');
  }

  // Build tool call with status
  const toolCallWithStatus: ToolCallWithStatus = {
    id: normalized.id,
    toolName: normalized.toolName,
    arguments: normalized.arguments,
    status,
    reason,
    failureType: status === 'failed' ? 'validation' : undefined,
  };

  return {
    id: normalized.id,
    type: getEditType(normalized.toolName),
    title: getToolTitle(normalized.toolName),
    description: generateToolSummary(normalized.toolName, normalized.arguments),
    data: normalized.arguments,
    toolCall: toolCallWithStatus,
    onApply: options?.onApply,
    onReject: options?.onReject,
  };
}

/**
 * Options for building multiple EditCards
 */
export interface BuildEditCardsOptions {
  /** Factory for Apply handlers */
  createApplyHandler?: (toolCall: NormalizedToolCall) => () => void;
  /** Factory for Reject handlers */
  createRejectHandler?: (toolCall: NormalizedToolCall) => () => void;
  /** Initial status for all cards (e.g., 'validating') */
  initialStatus?: ToolCallStatus;
  /** Validation results map (keyed by tool call ID) */
  validationResults?: Map<string, ValidationResult>;
}

/**
 * Build multiple EditCards from tool calls
 */
export function buildEditCards(
  toolCalls: Array<RawToolCall | NormalizedToolCall>,
  options?: BuildEditCardsOptions
): EditCard[] {
  return toolCalls.map(tc => {
    const normalized = 'toolName' in tc
      ? tc as NormalizedToolCall
      : normalizeToolCall(tc as RawToolCall);

    return buildEditCard(tc, {
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

    const newStatus: ToolCallStatus = result.valid ? 'pending' : 'failed';
    const newReason = result.valid ? undefined : result.error;

    return {
      ...card,
      toolCall: {
        ...card.toolCall,
        status: newStatus,
        reason: newReason,
        failureType: newStatus === 'failed' ? 'validation' : undefined,
      },
    };
  });
}

/**
 * Build EditCards from tool calls already stored in chat history.
 * Preserves status/result fields instead of re-running validation.
 */
export function buildEditCardsFromToolCallMetadata(
  toolCalls: ToolCallMetadata[]
): EditCard[] {
  return toolCalls.map((tc) => {
    const card = buildEditCard({
      id: tc.id,
      tool_name: tc.tool_name,
      arguments: tc.arguments,
    });

    const acceptedAt =
      tc.acceptedAt instanceof Date
        ? tc.acceptedAt
        : tc.acceptedAt
          ? new Date(tc.acceptedAt as any)
          : undefined;

    return {
      ...card,
      toolCall: {
        ...card.toolCall,
        status: tc.status,
        reason: tc.reason,
        failureType: tc.failureType,
        result: tc.result,
        acceptedAt,
      },
    };
  });
}

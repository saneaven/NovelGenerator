/**
 * Tool Call System - Core Types
 *
 * This module defines the core types for the tool call UI.
 * Tool calls are routed by canonical prefix and then handled by the matching UI module.
 */

import type { ObjectType, UnifiedObject } from '../types/unifiedObject';

// ============================================================================
// TOOL CATEGORIES
// ============================================================================

/** Categories of tool operations */
export type ToolCategory =
  | 'read'
  | 'create'
  | 'replace'
  | 'patch'
  | 'delete'
  | 'translate'
  | 'patch_translation'
  | 'search'
  | 'call'
  | 'generate';

/** Target types for tool operations */
export type TargetType =
  | 'basic_info'
  | 'guidelines'
  | 'story_entity'
  | 'outline'
  | 'manuscript'
  | 'sub_agent'
  | 'scene_image'
  | 'object_image';

/** Story entity kinds (used in tool arguments) */
export type StoryEntityKind =
  | 'character'
  | 'location'
  | 'organization'
  | 'lorebook';

/** Execution modes for the tool-call system */
export type ExecutionMode = 'object' | 'novelEditor' | 'translation' | 'editAssistant';

// ============================================================================
// TOOL CALL STATUS
// ============================================================================

/**
 * Status of a tool call
 * - streaming: tool call arguments are being streamed from LLM
 * - validating: async validation in progress
 * - pending: validation passed, awaiting user decision
 * - processing: apply in progress
 * - working: interactive tool session in progress
 * - failed: validation or execution failed
 * - rejected: user rejected
 * - applied: execution completed successfully
 */
export type ToolCallStatus = 'streaming' | 'validating' | 'pending' | 'processing' | 'working' | 'failed' | 'rejected' | 'applied';

/** Type of failure when status is 'failed' */
export type ToolCallFailureType = 'validation' | 'execution' | 'partial';

/** User decision for a pending tool call */
export type ToolCallDecision = 'accept' | 'reject' | 'cancel';

/** Explicit decisions keyed by tool call ID (only listed IDs are processed) */
export type ToolCallDecisionMap = Record<string, ToolCallDecision>;

// ============================================================================
// TOOL CALL TYPES
// ============================================================================

/**
 * Raw tool call from LLM response (before normalization)
 */
export interface RawToolCall {
  id: string;
  tool_name: string;
  arguments: string | Record<string, unknown>;
}

/**
 * Normalized tool call with parsed arguments
 * Arguments are always an object after normalization
 */
export interface NormalizedToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool call with application status (for UI tracking)
 */
export interface ToolCallWithStatus extends NormalizedToolCall {
  /** Current status of the tool call */
  status: ToolCallStatus;
  /** Auxiliary tool-specific UI payload from backend */
  extraContent?: Record<string, unknown> | null;
  /** Linked image generation lifecycle for image tools */
  imageRunId?: string | null;
  /** Error message (when failed) or user-provided reason (when rejected) */
  reason?: string;
  /** Type of failure when status is 'failed' */
  failureType?: ToolCallFailureType;
  /** Result from applying the tool call (when accepted) */
  result?: ApplicationResult;
  /** Timestamp when the tool call was accepted */
  acceptedAt?: Date;
}

// ============================================================================
// APPLICATION RESULT
// ============================================================================

/**
 * Result of applying a tool call
 */
export interface ApplicationResult {
  success: boolean;
  message: string;
  error?: string;
  /** ID of the affected object */
  objectId?: string;
  /** Type of the affected object */
  objectType?: string;
  /** Data that was applied */
  data?: Record<string, unknown>;
}

// ============================================================================
// EXECUTION CONTEXT
// ============================================================================

/**
 * Context for tool call execution.
 */
export interface ExecutionContext {
  projectId: string;
  /** Language for the operation (main language for CRUD, target language for translation) */
  language: string;
}

// ============================================================================
// HANDLER TYPES
// ============================================================================

/**
 * Handler function signature
 */
export type ToolHandler = (
  args: Record<string, unknown>,
  context: ExecutionContext
) => Promise<ApplicationResult>;

/**
 * Handler metadata for registration
 */
export interface HandlerMetadata {
  name: string;
  category: ToolCategory;
  target: TargetType;
  handler: ToolHandler;
}

// ============================================================================
// SCHEMA TYPES
// ============================================================================

/**
 * JSON Schema for tool parameters
 */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
}

/**
 * Tool schema with metadata
 */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Category for filtering */
  category: ToolCategory;
  /** Target type for routing */
  target: TargetType;
  /** Which parameter is the ID field */
  idParam?: string;
}

/**
 * Validation result from schema validation
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

// ============================================================================
// EDIT CARD TYPES
// ============================================================================

/**
 * Edit card for displaying tool call in UI
 */
export interface EditCard {
  id: string;
  type: string;
  title: string;
  description: string;
  data: Record<string, unknown>;
  toolCall: ToolCallWithStatus;
  onApply?: () => void;
  onReject?: (reason?: string) => void;
}

// ============================================================================
// TYPE MAPPING CONSTANTS
// ============================================================================

/** Maps story entity kind to unified object type */
export const STORY_ENTITY_TYPE_MAP: Record<StoryEntityKind, ObjectType> = {
  character: 'story_entity',
  location: 'story_entity',
  organization: 'story_entity',
  lorebook: 'story_entity',
};

/** All object types including outline structure (for translation and validation) */
export const ALL_OBJECT_TYPE_MAP: Record<string, ObjectType> = {
  story_entity: 'story_entity',
  outline: 'outline',
};

/** Helper to get object data for a language with fallback */
export function getObjectData(
  object: UnifiedObject,
  language: string
): Record<string, unknown> {
  const data = object.data[language];
  if (data) return data;
  const availableLanguages = Object.keys(object.data);
  if (availableLanguages.length > 0) {
    return object.data[availableLanguages[0]];
  }
  return {};
}

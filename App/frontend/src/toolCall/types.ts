/**
 * Tool Call System - Core Types
 *
 * This module defines the core types for the unified tool call system.
 * All tool calls are normalized before processing to ensure consistency.
 */

import type { ObjectType, UnifiedObject } from '../types/unifiedObject';

// ============================================================================
// TOOL CATEGORIES
// ============================================================================

/** Categories of tool operations */
export type ToolCategory = 'crud' | 'replace' | 'patch' | 'translation' | 'read';

/** Target types for tool operations */
export type TargetType = 'basic_info' | 'guidelines' | 'story_object' | 'outline' | 'chapter' | 'manuscript' | 'sub_agent';

/** Story object subtypes (used in tool arguments) */
export type StoryObjectSubtype =
  | 'character'
  | 'location'
  | 'organization'
  | 'lorebook';

/** Execution modes for the tool-call system */
export type ExecutionMode = 'storyObject' | 'novelEditor' | 'translation' | 'editAssistant';

// ============================================================================
// TOOL CALL STATUS
// ============================================================================

/**
 * Status of a tool call
 * - validating: Async validation in progress (post-streaming)
 * - pending: Validation passed, awaiting Apply
 * - processing: Apply in progress for non-Sub Agent tool calls (local-only)
 * - running: Apply in progress (long-running tool call)
 * - failed: Validation or execution failed
 * - accepted: Apply completed successfully
 * - rejected: User rejected the tool call
 * - cancelled: Execution cancelled or failed at runtime
 */
export type ToolCallStatus = 'validating' | 'pending' | 'processing' | 'running' | 'failed' | 'accepted' | 'rejected' | 'cancelled';

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
 * Context for tool call execution
 *
 * Note: mode is NOT included here because handlers route by tool name,
 * not by mode. Mode only affects which tool schemas are sent to the LLM
 * (see schemaRegistry.getForMode).
 *
 * For translation operations, pass the target language as `language`.
 * Translation handlers use `create_new_version: false` while CRUD handlers use `true`.
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

/** Maps story object subtype to unified object type */
export const STORY_OBJECT_TYPE_MAP: Record<StoryObjectSubtype, ObjectType> = {
  character: 'character',
  location: 'location',
  organization: 'organization',
  lorebook: 'lorebook',
};

/** All object types including outline structure (for translation and validation) */
export const ALL_OBJECT_TYPE_MAP: Record<string, ObjectType> = {
  character: 'character',
  location: 'location',
  organization: 'organization',
  lorebook: 'lorebook',
  act: 'act',
  chapter: 'chapter',
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

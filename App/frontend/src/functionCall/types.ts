/**
 * Function Call System - Core Types
 *
 * This module defines the core types for the unified function call system.
 * All function calls are normalized before processing to ensure consistency.
 */

import type { ObjectType, UnifiedObject } from '../types/unifiedObject';

// ============================================================================
// FUNCTION CATEGORIES
// ============================================================================

/** Categories of function operations */
export type FunctionCategory = 'crud' | 'replace' | 'patch' | 'translation' | 'read';

/** Target types for function operations */
export type TargetType = 'basic_info' | 'story_object' | 'outline' | 'chapter' | 'manuscript';

/** Story object subtypes (used in function arguments) */
export type StoryObjectSubtype =
  | 'character'
  | 'location'
  | 'organization'
  | 'lorebook';

/** Execution modes for the function-call system */
export type ExecutionMode = 'storyObject' | 'novelEditor' | 'translation' | 'editAssistant';

// ============================================================================
// FUNCTION CALL STATUS
// ============================================================================

/**
 * Status of a function call
 * - validating: Async validation in progress (post-streaming)
 * - pending: Validation passed, awaiting Apply
 * - failed: Validation or execution failed
 * - accepted: Apply completed successfully
 * - rejected: User rejected the function call
 */
export type FunctionCallStatus = 'validating' | 'pending' | 'failed' | 'accepted' | 'rejected';

/** Type of failure when status is 'failed' */
export type FunctionCallFailureType = 'validation' | 'execution' | 'partial';

// ============================================================================
// FUNCTION CALL TYPES
// ============================================================================

/**
 * Raw function call from LLM response (before normalization)
 */
export interface RawFunctionCall {
  id: string;
  function_name: string;
  arguments: string | Record<string, unknown>;
}

/**
 * Normalized function call with parsed arguments
 * Arguments are always an object after normalization
 */
export interface NormalizedFunctionCall {
  id: string;
  functionName: string;
  arguments: Record<string, unknown>;
}

/**
 * Function call with application status (for UI tracking)
 */
export interface FunctionCallWithStatus extends NormalizedFunctionCall {
  /** Current status of the function call */
  status: FunctionCallStatus;
  /** Error message (when failed) or user-provided reason (when rejected) */
  reason?: string;
  /** Type of failure when status is 'failed' */
  failureType?: FunctionCallFailureType;
  /** Result from applying the function call (when accepted) */
  result?: ApplicationResult;
  /** Timestamp when the function call was accepted */
  acceptedAt?: Date;
}

// ============================================================================
// APPLICATION RESULT
// ============================================================================

/**
 * Result of applying a function call
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
 * Context for function call execution
 *
 * Note: mode is NOT included here because handlers route by function name,
 * not by mode. Mode only affects which function schemas are sent to the LLM
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
export type FunctionHandler = (
  args: Record<string, unknown>,
  context: ExecutionContext
) => Promise<ApplicationResult>;

/**
 * Handler metadata for registration
 */
export interface HandlerMetadata {
  name: string;
  category: FunctionCategory;
  target: TargetType;
  handler: FunctionHandler;
}

// ============================================================================
// SCHEMA TYPES
// ============================================================================

/**
 * JSON Schema for function parameters
 */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
}

/**
 * Function schema with metadata
 */
export interface FunctionSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Category for filtering */
  category: FunctionCategory;
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
 * Edit card for displaying function call in UI
 */
export interface EditCard {
  id: string;
  type: string;
  title: string;
  description: string;
  data: Record<string, unknown>;
  functionCall: FunctionCallWithStatus;
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

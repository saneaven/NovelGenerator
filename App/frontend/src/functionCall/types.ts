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
export type FunctionCategory = 'crud' | 'replace' | 'patch' | 'translation';

/** Target types for function operations */
export type TargetType = 'basic_info' | 'story_object' | 'outline' | 'chapter' | 'manuscript';

/** Story object subtypes (used in function arguments) */
export type StoryObjectSubtype =
  | 'character'
  | 'location'
  | 'organization'
  | 'lorebook';

/** Execution modes for the applicator */
export type ExecutionMode = 'storyObject' | 'novelEditor' | 'translation' | 'editAssistant';

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
  isApplied: boolean;
  isRejected?: boolean;
  appliedAt?: Date;
  error?: string;
  resultMessage?: string;
}

// ============================================================================
// APPLICATION RESULT
// ============================================================================

/**
 * Retry context when patch operations fail
 */
export interface PatchRetryContext {
  objectId: string;
  objectType?: string;
  fieldName: string;
  currentValue: string;
  error: string;
}

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
  /** Contexts for fields that need retry (patch failed) */
  retryContexts?: PatchRetryContext[];
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
 */
export interface ExecutionContext {
  projectId: string;
  language: string;
  /** Target language for translation operations */
  targetLanguage?: string;
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
  isApplied: boolean;
  isRejected?: boolean;
  appliedAt?: Date;
  data: Record<string, unknown>;
  functionCall: FunctionCallWithStatus;
  onApply?: () => void;
  onReject?: () => void;
  /** Validation error (card cannot be applied) */
  validationError?: string;
  /** Apply error (card stays pending after failed apply) */
  applyError?: string;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

/** Maps story object subtype to unified object type */
export const STORY_OBJECT_TYPE_MAP: Record<StoryObjectSubtype, ObjectType> = {
  character: 'character',
  location: 'location',
  organization: 'organization',
  lorebook: 'lorebook',
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

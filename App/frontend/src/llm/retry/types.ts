/**
 * Retry System Types
 *
 * Types for the unified function call retry system.
 * Used to categorize, aggregate, and display function call results
 * for retry functionality across all LLMTask contexts.
 */

import type { ContentPart } from '../requestTypes';
import type { PromptBundle, LLMTaskResult } from '../types';

/**
 * Types of function call failures
 */
export type FunctionCallFailureType =
  | 'parsing_failed'      // JSON parsing error
  | 'validation_failed'   // Schema validation error
  | 'application_failed'  // Error during application (e.g., patch not found)
  | 'user_rejected';      // User explicitly rejected the function call

/**
 * Patch failure detail for application errors
 */
export interface PatchFailureDetail {
  objectId: string;
  objectType?: string;
  fieldName: string;
  error: string;
}

/**
 * Categorized result of a single function call
 * Includes full arguments for display in UI
 */
export interface CategorizedFunctionCallResult {
  /** Unique ID of the function call */
  functionCallId: string;

  /** Name of the function that was called */
  functionName: string;

  /** Full arguments object for display */
  arguments: Record<string, any>;

  /** Type of failure, or 'success' if succeeded */
  failureType: FunctionCallFailureType | 'success';

  /** Whether the function call succeeded */
  success: boolean;

  /** Whether the user rejected this function call */
  isRejected: boolean;

  /** Human-readable result message */
  resultMessage: string;

  /** Error message if failed */
  error?: string;

  /** Patch-specific failure details */
  patchFailures?: PatchFailureDetail[];
}

/**
 * Aggregated results of all function calls in a session
 */
export interface AggregatedFunctionCallResults {
  /** Session ID this belongs to */
  sessionId: string;

  /** Total number of function calls */
  total: number;

  /** Number of successful function calls */
  successCount: number;

  /** Number of failed function calls */
  failureCount: number;

  /** Number of user-rejected function calls */
  rejectedCount: number;

  /** All individual results */
  results: CategorizedFunctionCallResult[];

  /** Grouped by failure type for template rendering */
  successResults: CategorizedFunctionCallResult[];
  parsingFailures: CategorizedFunctionCallResult[];
  validationFailures: CategorizedFunctionCallResult[];
  applicationFailures: CategorizedFunctionCallResult[];

  /** Human-readable summary for display */
  summaryText: string;
}

/**
 * Serialized message format for sending to backend
 * Uses OpenAI tool_calls format as unified format
 */
export interface SerializedToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

/**
 * Serialized assistant message with tool calls
 */
export interface SerializedAssistantMessage {
  role: 'assistant';
  content: string;
  tool_calls?: SerializedToolCall[];
}

/**
 * Conversation snapshot stored for retry
 * Contains everything needed to reconstruct the conversation
 */
export interface ConversationSnapshot {
  /** The actual messages sent to LLM (already rendered) */
  renderedMessages: Array<{
    role: string;
    content?: string;
    contentParts?: ContentPart[];
  }>;

  /** Function schemas used */
  functions: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, any>;
  }>;

  /** AI's response */
  result: LLMTaskResult;

  /** Original prompt context (for callbacks) */
  promptBundle?: PromptBundle;
}

/**
 * Template data for retry prompt rendering
 */
export interface RetryTemplateData {
  retry: {
    total: number;
    successCount: number;
    failureCount: number;
    successResults: CategorizedFunctionCallResult[];
    parsingFailures: CategorizedFunctionCallResult[];
    validationFailures: CategorizedFunctionCallResult[];
    applicationFailures: CategorizedFunctionCallResult[];
  };
}

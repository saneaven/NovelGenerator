/**
 * Validation Types
 *
 * Type definitions for the tool call validation system.
 * Validation runs at two phases:
 * 1. Post-streaming: Immediately after LLM response
 * 2. Pre-apply: Before executing the tool call
 */

export interface ValidationContext {
  projectId: string;
  language: string;
}

/**
 * Result of validating a tool call
 */
export interface ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error message when validation fails */
  error?: string;
  /** Type of failure (always 'validation' for validation errors) */
  failureType?: 'validation';
}

/**
 * Validator function signature
 * Can be sync or async
 */
export type Validator = (
  args: Record<string, unknown>,
  toolName: string,
  context: ValidationContext
) => Promise<ValidationResult> | ValidationResult;

/**
 * Create a successful validation result
 */
export function validResult(): ValidationResult {
  return { valid: true };
}

/**
 * Create a failed validation result
 */
export function invalidResult(error: string): ValidationResult {
  return { valid: false, error, failureType: 'validation' };
}

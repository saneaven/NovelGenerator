/**
 * Validation Types
 *
 * Type definitions for the function call validation system.
 * Validation runs at two phases:
 * 1. Post-streaming: Immediately after LLM response
 * 2. Pre-apply: Before executing the function call
 */

/**
 * Result of validating a function call
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
  functionName: string
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

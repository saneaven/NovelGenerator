/**
 * Validation Module
 *
 * Provides validation infrastructure for function calls.
 * Validation runs at two phases:
 * 1. Post-streaming: Immediately after LLM response
 * 2. Pre-apply: Before executing the function call
 */

// Types
export type { ValidationResult, Validator } from './types';
export { validResult, invalidResult } from './types';

// Main validation function
export { validate, validateOne } from './validate';

// Registry (for extension if needed)
export { getValidators, FUNCTION_VALIDATORS } from './ValidatorRegistry';

// Individual validators (for testing/extension)
export {
  validateTypeMapping,
  validateRequiredId,
  validatePatchRequiredFields,
  validateObjectExists,
  validatePatchApplicable,
  resolveObjectType,
} from './validators';

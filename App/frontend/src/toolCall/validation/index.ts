/**
 * Validation Module
 *
 * Provides validation infrastructure for tool calls.
 * Validation runs at two phases:
 * 1. Post-streaming: Immediately after LLM response
 * 2. Pre-apply: Before executing the tool call
 */

// Types
export type { ValidationContext, ValidationResult, Validator } from './types';
export { validResult, invalidResult } from './types';

// Main validation function
export { validate, validateOne } from './validate';

// Registry (for extension if needed)
export { getValidators, TOOL_VALIDATORS } from './ValidatorRegistry';

// Individual validators (for testing/extension)
export {
  validateTypeMapping,
  validateRequiredId,
  validatePatchRequiredFields,
  validateObjectExists,
  validatePatchApplicable,
  validateOutlineParentExists,
  validateActParentExists,
  resolveObjectType,
} from './validators';

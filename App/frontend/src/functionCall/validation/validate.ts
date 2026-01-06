/**
 * Validation Executor
 *
 * Main validation function that runs validators for function calls.
 * Designed to be called at two phases:
 * 1. Post-streaming: Validate all function calls immediately after LLM response
 * 2. Pre-apply: Re-validate before executing (handles data changes)
 */

import type { NormalizedFunctionCall } from '../types';
import type { ValidationContext, ValidationResult } from './types';
import { validResult } from './types';
import { getValidators } from './ValidatorRegistry';

/**
 * Validate multiple function calls in parallel.
 *
 * @param functionCalls - Array of normalized function calls to validate
 * @returns Map from function call ID to validation result
 */
export async function validate(
  functionCalls: NormalizedFunctionCall[],
  context: ValidationContext
): Promise<Map<string, ValidationResult>> {
  const results = new Map<string, ValidationResult>();

  await Promise.all(
    functionCalls.map(async (fc) => {
      const validators = getValidators(fc.functionName);

      // Run validators in sequence (first failure stops chain)
      for (const validator of validators) {
        try {
          const result = await validator(fc.arguments, fc.functionName, context);
          if (!result.valid) {
            results.set(fc.id, result);
            return;
          }
        } catch (error) {
          // Handle unexpected validator errors
          results.set(fc.id, {
            valid: false,
            error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
            failureType: 'validation',
          });
          return;
        }
      }

      // All validators passed
      results.set(fc.id, validResult());
    })
  );

  return results;
}

/**
 * Validate a single function call.
 * Convenience wrapper around validate() for single-call use cases.
 *
 * @param functionCall - The function call to validate
 * @returns Validation result
 */
export async function validateOne(
  functionCall: NormalizedFunctionCall,
  context: ValidationContext
): Promise<ValidationResult> {
  const results = await validate([functionCall], context);
  return results.get(functionCall.id) ?? validResult();
}

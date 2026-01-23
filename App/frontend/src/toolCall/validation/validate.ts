/**
 * Validation Executor
 *
 * Main validation function that runs validators for tool calls.
 * Designed to be called at two phases:
 * 1. Post-streaming: Validate all tool calls immediately after LLM response
 * 2. Pre-apply: Re-validate before executing (handles data changes)
 */

import type { NormalizedToolCall } from '../types';
import type { ValidationContext, ValidationResult } from './types';
import { validResult } from './types';
import { getValidators } from './ValidatorRegistry';

/**
 * Validate multiple tool calls in parallel.
 *
 * @param toolCalls - Array of normalized tool calls to validate
 * @returns Map from tool call ID to validation result
 */
export async function validate(
  toolCalls: NormalizedToolCall[],
  context: ValidationContext
): Promise<Map<string, ValidationResult>> {
  const results = new Map<string, ValidationResult>();

  await Promise.all(
    toolCalls.map(async (tc) => {
      const validators = getValidators(tc.toolName);

      // Run validators in sequence (first failure stops chain)
      for (const validator of validators) {
        try {
          const result = await validator(tc.arguments, tc.toolName, context);
          if (!result.valid) {
            results.set(tc.id, result);
            return;
          }
        } catch (error) {
          // Handle unexpected validator errors
          results.set(tc.id, {
            valid: false,
            error: `Validation error: ${error instanceof Error ? error.message : String(error)}`,
            failureType: 'validation',
          });
          return;
        }
      }

      // All validators passed
      results.set(tc.id, validResult());
    })
  );

  return results;
}

/**
 * Validate a single tool call.
 * Convenience wrapper around validate() for single-call use cases.
 *
 * @param toolCall - The tool call to validate
 * @returns Validation result
 */
export async function validateOne(
  toolCall: NormalizedToolCall,
  context: ValidationContext
): Promise<ValidationResult> {
  const results = await validate([toolCall], context);
  return results.get(toolCall.id) ?? validResult();
}

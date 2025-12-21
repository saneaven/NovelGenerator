/**
 * Function Call Normalizer
 *
 * Normalizes raw function calls from LLM responses to a consistent format.
 * - Parses string arguments to objects
 * - Validates against schema
 * - Returns normalized function calls ready for application
 */

import type {
  RawFunctionCall,
  NormalizedFunctionCall,
  ValidationResult,
} from '../types';
import { schemaRegistry } from '../schemas';

/**
 * Parse function call arguments
 * Arguments can come as string (JSON) or already parsed object
 */
function parseArguments(args: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof args === 'string') {
    try {
      return JSON.parse(args);
    } catch {
      console.error('Failed to parse function arguments:', args);
      return {};
    }
  }
  return args ?? {};
}

/**
 * Validate function call against its schema
 */
export function validateFunctionCall(
  functionName: string,
  args: Record<string, unknown>
): ValidationResult {
  const schema = schemaRegistry.get(functionName);

  if (!schema) {
    return {
      valid: false,
      errors: [`Unknown function: ${functionName}`],
    };
  }

  const errors: string[] = [];
  const { required = [], properties = {} } = schema.parameters;

  // Check required parameters
  for (const param of required) {
    if (args[param] === undefined || args[param] === null) {
      errors.push(`Missing required parameter: ${param}`);
    }
  }

  // Check for empty string on required parameters
  for (const param of required) {
    if (typeof args[param] === 'string' && args[param] === '') {
      errors.push(`Required parameter cannot be empty: ${param}`);
    }
  }

  // Check enum values if specified
  for (const [key, value] of Object.entries(args)) {
    const propSchema = properties[key] as Record<string, unknown> | undefined;
    if (propSchema?.enum && Array.isArray(propSchema.enum) && !propSchema.enum.includes(value)) {
      errors.push(`Invalid value for ${key}: ${value}. Expected one of: ${(propSchema.enum as string[]).join(', ')}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Normalize a raw function call to a consistent format
 */
export function normalizeFunctionCall(raw: RawFunctionCall): NormalizedFunctionCall {
  const args = parseArguments(raw.arguments);

  return {
    id: raw.id,
    functionName: raw.function_name,
    arguments: args,
  };
}

/**
 * Normalize multiple raw function calls
 */
export function normalizeFunctionCalls(rawCalls: RawFunctionCall[]): NormalizedFunctionCall[] {
  return rawCalls.map(normalizeFunctionCall);
}

/**
 * Normalize and validate a function call
 * Returns normalized call and validation result
 */
export function normalizeAndValidate(
  raw: RawFunctionCall
): { normalized: NormalizedFunctionCall; validation: ValidationResult } {
  const normalized = normalizeFunctionCall(raw);
  const validation = validateFunctionCall(normalized.functionName, normalized.arguments);

  return { normalized, validation };
}

/**
 * Check if a function name is known
 */
export function isKnownFunction(functionName: string): boolean {
  return schemaRegistry.has(functionName);
}

/**
 * Get the ID parameter value from function arguments
 * Different functions use different parameter names for the target ID
 */
export function getIdFromArgs(functionName: string, args: Record<string, unknown>): string | undefined {
  const schema = schemaRegistry.get(functionName);
  if (!schema?.idParam) {
    return undefined;
  }
  const id = args[schema.idParam];
  return typeof id === 'string' ? id : undefined;
}

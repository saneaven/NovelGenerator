/**
 * Tool Call Normalizer
 *
 * Normalizes raw tool calls from LLM responses to a consistent format.
 * - Parses string arguments to objects
 * - Validates against schema
 * - Returns normalized tool calls ready for application
 */

import type {
  RawToolCall,
  NormalizedToolCall,
  ValidationResult,
} from '../types';
import { schemaRegistry } from '../schemas';

/**
 * Parse tool call arguments
 * Arguments can come as string (JSON) or already parsed object
 */
function parseArguments(args: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof args === 'string') {
    try {
      return JSON.parse(args);
    } catch {
      console.error('Failed to parse tool arguments:', args);
      return {};
    }
  }
  return args ?? {};
}

/**
 * Validate tool call against its schema
 */
export function validateToolCall(
  toolName: string,
  args: Record<string, unknown>
): ValidationResult {
  const schema = schemaRegistry.get(toolName);

  if (!schema) {
    return {
      valid: false,
      errors: [`Unknown tool: ${toolName}`],
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
 * Normalize a raw tool call to a consistent format
 */
export function normalizeToolCall(raw: RawToolCall): NormalizedToolCall {
  const args = parseArguments(raw.arguments);

  return {
    id: raw.id,
    toolName: raw.tool_name,
    arguments: args,
  };
}

/**
 * Normalize multiple raw tool calls
 */
export function normalizeToolCalls(rawCalls: RawToolCall[]): NormalizedToolCall[] {
  return rawCalls.map(normalizeToolCall);
}

/**
 * Normalize and validate a tool call
 * Returns normalized call and validation result
 */
export function normalizeAndValidate(
  raw: RawToolCall
): { normalized: NormalizedToolCall; validation: ValidationResult } {
  const normalized = normalizeToolCall(raw);
  const validation = validateToolCall(normalized.toolName, normalized.arguments);

  return { normalized, validation };
}

/**
 * Check if a tool name is known
 */
export function isKnownTool(toolName: string): boolean {
  return schemaRegistry.has(toolName);
}

/**
 * Get the ID parameter value from tool arguments
 * Different tools use different parameter names for the target ID
 */
export function getIdFromArgs(toolName: string, args: Record<string, unknown>): string | undefined {
  const schema = schemaRegistry.get(toolName);
  if (!schema?.idParam) {
    return undefined;
  }
  const id = args[schema.idParam];
  return typeof id === 'string' ? id : undefined;
}

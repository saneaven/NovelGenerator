/**
 * Template variable validation logic
 */
import type { FunctionType } from '../types/prompts';
import type { PromptType } from './schema';
import { PROMPT_SCHEMAS } from './schema';
import type { VariableReference } from './engine';

export interface VariableWarning {
  message: string;
  line?: number;
  column?: number;
  severity: 'warning';
  variablePath: string;
}

/**
 * Maps FunctionType to PromptType (schema type)
 */
export function mapFunctionTypeToSchemaType(
  functionType: FunctionType,
  name?: string
): PromptType | null {
  // Map function types to schema types
  switch (functionType) {
    case 'chat':
      return 'chat';
    case 'translation':
      return 'translation';
    case 'storyObjectEdit':
      return 'storyObjectEdit';
    case 'chapterGen':
      return 'chapterEdit';
    case 'imagePrompt':
      return name === 'scene' ? 'sceneImagePrompt' : 'objectImagePrompt';
    default:
      return null;
  }
}

/**
 * Traverses an object to check if a path exists.
 * Returns the value at the path if it exists, undefined otherwise.
 * For arrays, validates that the property exists on array items.
 */
function traverseObjectPath(obj: unknown, pathSegments: string[]): { exists: boolean; value?: unknown } {
  if (pathSegments.length === 0) {
    return { exists: true, value: obj };
  }

  if (obj === null || obj === undefined) {
    return { exists: false };
  }

  const [current, ...rest] = pathSegments;

  // Handle arrays: check if property exists on first element
  if (Array.isArray(obj)) {
    // Liquid built-in array properties
    if (['size', 'first', 'last'].includes(current)) {
      // These are valid Liquid properties for arrays
      return { exists: true };
    }

    if (obj.length === 0) {
      // Empty array in example - can't validate further
      return { exists: true };
    }
    // Check the first array element for the property
    return traverseObjectPath(obj[0], pathSegments);
  }

  // Handle objects
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    if (current in record) {
      return traverseObjectPath(record[current], rest);
    }
    return { exists: false };
  }

  // Primitive types can't have properties
  return { exists: false };
}

/**
 * Checks if a deep path exists in the schema example for context fields.
 * This validates paths like context.storyContext.outline.acts against the example structure.
 */
function isDeepPathValidInExample(
  variablePath: string[],
  schemaType: PromptType
): { valid: boolean; reason?: string; suggestedPath?: string } {
  // Only validate context paths with more than 2 segments
  if (variablePath.length <= 2 || variablePath[0] !== 'context') {
    return { valid: true };
  }

  const [, field, ...deepPath] = variablePath;
  const schema = PROMPT_SCHEMAS[schemaType];
  const contextSchema = schema.context;

  if (!contextSchema || !(field in contextSchema)) {
    return { valid: true }; // Let basic validation handle this
  }

  const fieldDef = (contextSchema as Record<string, { example?: unknown }>)[field];
  if (!fieldDef?.example) {
    return { valid: true }; // No example to validate against
  }

  // Check if the deep path exists in the example
  const result = traverseObjectPath(fieldDef.example, deepPath);

  if (!result.exists) {
    // Try to suggest a correct path
    let suggestedPath: string | undefined;

    // Common mistake: accessing acts directly instead of outline.acts
    if (deepPath[0] === 'acts' && fieldDef.example && typeof fieldDef.example === 'object') {
      const example = fieldDef.example as Record<string, unknown>;
      if ('outline' in example && typeof example.outline === 'object' && example.outline !== null) {
        const outline = example.outline as Record<string, unknown>;
        if ('acts' in outline) {
          suggestedPath = `context.${field}.outline.acts`;
        }
      }
    }

    return {
      valid: false,
      reason: 'deep_path_not_found',
      suggestedPath
    };
  }

  return { valid: true };
}

/**
 * Checks if a variable path exists in the given schema
 */
function isVariableDefinedInSchema(
  variablePath: string[],
  schemaType: PromptType
): { valid: boolean; reason?: string; suggestedPath?: string } {
  if (variablePath.length === 0) {
    return { valid: false, reason: 'empty' };
  }

  const [group, field] = variablePath;
  const schema = PROMPT_SCHEMAS[schemaType];

  // Check if the group is valid (variable, context, or state)
  if (group !== 'variable' && group !== 'context' && group !== 'state') {
    return { valid: false, reason: 'invalid_group' };
  }

  // If it's just the group without a field, it's technically valid but unusual
  if (variablePath.length === 1) {
    return { valid: true };
  }

  // Get the schema for this group
  const groupSchema = schema[group as 'variable' | 'context' | 'state'];

  if (!groupSchema) {
    return { valid: false, reason: 'group_not_available' };
  }

  // Check if the field exists in the schema
  if (!(field in groupSchema)) {
    return { valid: false, reason: 'field_not_found' };
  }

  // For deeper paths (e.g., context.storyContext.outline.acts),
  // validate against the schema example structure
  if (variablePath.length > 2) {
    return isDeepPathValidInExample(variablePath, schemaType);
  }

  return { valid: true };
}

/**
 * Validates variable references against a schema
 */
export function validateVariablesAgainstSchema(
  references: VariableReference[],
  schemaType: PromptType
): VariableWarning[] {
  const warnings: VariableWarning[] = [];

  for (const ref of references) {
    const validationResult = isVariableDefinedInSchema(ref.path, schemaType);

    if (!validationResult.valid) {
      const [group] = ref.path;
      let message: string;

      switch (validationResult.reason) {
        case 'invalid_group':
          // Check for common typos
          if (group === 'varaible' || group === 'variabel') {
            message = `Typo detected: '${group}' should be 'variable'`;
          } else if (group === 'contxt' || group === 'kontext') {
            message = `Typo detected: '${group}' should be 'context'`;
          } else {
            message = `Invalid variable group: '${group}'. Must use 'variable', 'context', or 'state'`;
          }
          break;

        case 'group_not_available':
          message = `No '${group}' variables available for this prompt type`;
          break;

        case 'field_not_found':
          // Suggest available fields
          const schema = PROMPT_SCHEMAS[schemaType][group as 'variable' | 'context' | 'state'];
          const availableFields = Object.keys(schema || {});
          message = `Undefined variable: ${ref.fullPath}. Available fields in '${group}': ${availableFields.join(', ')}`;
          break;

        case 'deep_path_not_found':
          // Path doesn't exist in schema example
          if (validationResult.suggestedPath) {
            message = `Invalid path: ${ref.fullPath}. Did you mean: ${validationResult.suggestedPath}?`;
          } else {
            message = `Invalid path: ${ref.fullPath}. This property doesn't exist in the data structure.`;
          }
          break;

        case 'empty':
          message = `Empty variable reference`;
          break;

        default:
          message = `Undefined variable: ${ref.fullPath}`;
      }

      warnings.push({
        message,
        line: ref.location?.row,
        column: ref.location?.col,
        severity: 'warning',
        variablePath: ref.fullPath
      });
    }
  }

  return warnings;
}

/**
 * Gets all available variables for a schema type
 */
export function getAvailableVariables(schemaType: PromptType): {
  variable: string[];
  context: string[];
  state: string[];
} {
  const schema = PROMPT_SCHEMAS[schemaType];

  return {
    variable: Object.keys(schema.variable || {}),
    context: Object.keys(schema.context || {}),
    state: Object.keys(schema.state || {})
  };
}

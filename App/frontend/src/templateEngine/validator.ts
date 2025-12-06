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
 * Checks if a variable path exists in the given schema
 */
function isVariableDefinedInSchema(
  variablePath: string[],
  schemaType: PromptType
): { valid: boolean; reason?: string } {
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

  // For deeper paths (e.g., context.recentMessages.content),
  // we allow them since they're accessing object/array properties
  // We only validate the first two levels (group.field)
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

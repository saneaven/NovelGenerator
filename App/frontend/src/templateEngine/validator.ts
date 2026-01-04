/**
 * Template variable validation logic
 */
import type { FunctionType } from '../types/prompts';
import type { PromptType } from './schema';
import { UNIFIED_SCHEMA, PROMPT_TYPE_VARIABLES, isGroupAvailableForType } from './schema';
import type { VariableReference } from './engine';

export interface VariableWarning {
  message: string;
  line?: number;
  column?: number;
  severity: 'warning';
  variablePath: string;
}

/**
 * Maps FunctionType to PromptType
 */
export function mapFunctionTypeToSchemaType(
  functionType: FunctionType,
  name?: string
): PromptType | null {
  switch (functionType) {
    case 'agent':
      return 'agent';
    case 'translation':
      return 'translation';
    case 'editAssistant':
      return 'editAssistant';
    case 'imagePrompt':
      if (name === 'scene') return 'sceneImagePrompt';
      if (name === 'coverImage') return 'coverImagePrompt';
      return 'objectImagePrompt';
    default:
      return null;
  }
}

// All valid schema groups
const SCHEMA_GROUPS = ['config', 'project', 'input', 'agent', 'editAssistant', 'translation', 'imagePrompt'] as const;
type SchemaGroup = typeof SCHEMA_GROUPS[number];

/**
 * Traverses an object to check if a path exists.
 */
function traverseObjectPath(obj: unknown, pathSegments: string[]): { exists: boolean; value?: unknown } {
  if (pathSegments.length === 0) {
    return { exists: true, value: obj };
  }

  if (obj === null || obj === undefined) {
    return { exists: false };
  }

  const [current, ...rest] = pathSegments;

  if (Array.isArray(obj)) {
    if (['size', 'length', 'first', 'last'].includes(current)) {
      return { exists: true };
    }
    if (obj.length === 0) {
      return { exists: true };
    }
    return traverseObjectPath(obj[0], pathSegments);
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;
    if (current in record) {
      return traverseObjectPath(record[current], rest);
    }
    return { exists: false };
  }

  return { exists: false };
}

/**
 * Validates deep paths against schema examples
 */
function isDeepPathValid(
  variablePath: string[],
  group: string
): { valid: boolean; reason?: string } {
  if (variablePath.length <= 2) {
    return { valid: true };
  }

  const [, field, ...deepPath] = variablePath;
  const groupSchema = UNIFIED_SCHEMA[group as keyof typeof UNIFIED_SCHEMA];

  if (!groupSchema || !(field in groupSchema)) {
    return { valid: true };
  }

  const fieldDef = (groupSchema as Record<string, { example?: unknown }>)[field];
  if (!fieldDef?.example) {
    return { valid: true };
  }

  const result = traverseObjectPath(fieldDef.example, deepPath);

  if (!result.exists) {
    return { valid: false, reason: 'deep_path_not_found' };
  }

  return { valid: true };
}

/**
 * Checks if a variable path exists in the schema
 */
function isVariableDefinedInSchema(
  variablePath: string[],
  schemaType: PromptType
): { valid: boolean; reason?: string } {
  if (variablePath.length === 0) {
    return { valid: false, reason: 'empty' };
  }

  const [group, field] = variablePath;

  if (!SCHEMA_GROUPS.includes(group as SchemaGroup)) {
    return { valid: false, reason: 'invalid_group' };
  }

  if (!isGroupAvailableForType(group, schemaType)) {
    return { valid: false, reason: 'group_not_available_for_type' };
  }

  if (variablePath.length === 1) {
    return { valid: true };
  }

  const groupSchema = UNIFIED_SCHEMA[group as keyof typeof UNIFIED_SCHEMA];
  if (!groupSchema) {
    return { valid: false, reason: 'group_not_found' };
  }

  if (!(field in groupSchema)) {
    return { valid: false, reason: 'field_not_found' };
  }

  if (variablePath.length > 2) {
    return isDeepPathValid(variablePath, group);
  }

  return { valid: true };
}

/**
 * Validates variable references against schema
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
        case 'invalid_group': {
          const availableGroups = PROMPT_TYPE_VARIABLES[schemaType].join(', ');
          message = `Invalid variable group: '${group}'. Available groups: ${availableGroups}`;
          break;
        }

        case 'group_not_available_for_type': {
          const availableGroups = PROMPT_TYPE_VARIABLES[schemaType].join(', ');
          message = `Variable group '${group}' is not available for ${schemaType}. Available: ${availableGroups}`;
          break;
        }

        case 'group_not_found':
          message = `Unknown variable group: '${group}'`;
          break;

        case 'field_not_found': {
          const groupSchema = UNIFIED_SCHEMA[group as keyof typeof UNIFIED_SCHEMA];
          const availableFields = groupSchema ? Object.keys(groupSchema).join(', ') : 'none';
          message = `Undefined variable: ${ref.fullPath}. Available in '${group}': ${availableFields}`;
          break;
        }

        case 'deep_path_not_found':
          message = `Invalid path: ${ref.fullPath}. Property doesn't exist in the data structure.`;
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
export function getAvailableVariables(schemaType: PromptType): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const availableGroups = PROMPT_TYPE_VARIABLES[schemaType] || [];

  for (const group of availableGroups) {
    const groupSchema = UNIFIED_SCHEMA[group as keyof typeof UNIFIED_SCHEMA];
    if (groupSchema) {
      result[group] = Object.keys(groupSchema);
    }
  }

  return result;
}

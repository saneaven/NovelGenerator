/**
 * Types for prompt variable management
 */

/**
 * Supported variable types
 */
export type VariableType = 'string' | 'number' | 'boolean' | 'select';

/**
 * Options for number type variables
 */
export interface NumberOptions {
  min?: number;
  max?: number;
  step?: number;
  input_type: 'input' | 'slider';
}

/**
 * Variable response from API
 */
export interface PromptVariable {
  id: string;
  name: string;
  var_type: VariableType;
  value: string | number | boolean | null;
  select_options: string[] | null;
  number_options: NumberOptions | null;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Request to create a new variable
 */
export interface VariableCreate {
  name: string;
  var_type: VariableType;
  description?: string;
  select_options?: string[];
  default_value?: string | number | boolean;
  number_options?: NumberOptions;
}

/**
 * Request to update variable value only (auto-save)
 */
export interface VariableValueUpdate {
  value: string | number | boolean | null;
}

/**
 * Request to update variable definition
 */
export interface VariableDefinitionUpdate {
  name?: string;
  description?: string;
  select_options?: string[];
  display_order?: number;
  number_options?: NumberOptions;
}

/**
 * Variables for template response
 */
export interface VariablesForTemplateResponse {
  variables: Record<string, string | number | boolean | null>;
}

/**
 * Request to reorder variables
 */
export interface VariableReorderRequest {
  ordered_ids: string[];
}

/**
 * Get display label for variable type
 */
export function getVariableTypeLabel(type: VariableType): string {
  switch (type) {
    case 'string':
      return 'Text';
    case 'number':
      return 'Number';
    case 'boolean':
      return 'Toggle';
    case 'select':
      return 'Dropdown';
    default:
      return type;
  }
}

/**
 * Get default value for variable type
 */
export function getDefaultValueForType(type: VariableType, selectOptions?: string[]): string | number | boolean {
  switch (type) {
    case 'string':
      return '';
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'select':
      return selectOptions && selectOptions.length > 0 ? selectOptions[0] : '';
    default:
      return '';
  }
}

/**
 * Validate variable name format
 */
export function isValidVariableName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
}

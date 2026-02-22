import type { PromptType } from './schema';
import { validateVariablesAgainstSchema } from './validator';
import { templateService } from '../api/templateService';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Interface for variable reference with location information
 */
export interface VariableReference {
  path: string[];  // e.g., ['config', 'mainLanguage']
  fullPath: string;  // e.g., 'config.mainLanguage'
  location?: {
    row: number;
    col: number;
  };
}

/**
 * Enhanced validation result with warnings
 */
export interface ValidationResult {
  isValid: boolean;
  error?: string;
  warnings?: Array<{
    message: string;
    line?: number;
    column?: number;
    severity: 'warning';
  }>;
}

// ============================================================================
// TEMPLATE RENDERING
// ============================================================================

/**
 * Renders a Jinja2 template string via the backend API.
 * The backend loads fragments from the DB using the same pipeline as production.
 * @param template The Jinja2 template string
 * @param data The data object containing variable groups
 * @returns The rendered string
 */
export const renderTemplate = async (
  template: string,
  data: Record<string, any>,
): Promise<string> => {
  try {
    const response = await templateService.render(template, data);
    if (response.error) {
      return `[Template Error: ${response.error}]`;
    }
    return response.rendered;
  } catch (error) {
    console.error('Template rendering error:', error);
    return `[Template Error: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

// ============================================================================
// VARIABLE EXTRACTION (REGEX-BASED)
// ============================================================================

/** Jinja2 built-in names that are not user-defined variables */
const JINJA_BUILTINS = new Set([
  'true', 'false', 'none', 'True', 'False', 'None',
  'loop', 'super', 'self', 'varargs', 'kwargs',
  'range', 'lipsum', 'dict', 'cycler', 'joiner', 'namespace',
]);

/**
 * Extract locally-defined variable names from Jinja2 tags.
 * Detects: {% for VAR in ... %} and {% set VAR = ... %}
 */
function extractLocalVariables(template: string): Set<string> {
  const locals = new Set<string>();

  // {% for VAR in ... %}  (also handles tuple unpacking: {% for a, b in ... %})
  const forRegex = /\{%[-\s]*for\s+([\w\s,]+?)\s+in\s+/g;
  let match;
  while ((match = forRegex.exec(template)) !== null) {
    const vars = match[1].split(',');
    for (const v of vars) {
      const trimmed = v.trim();
      if (trimmed) locals.add(trimmed);
    }
  }

  // {% set VAR = ... %}
  const setRegex = /\{%[-\s]*set\s+(\w+)\s*=/g;
  while ((match = setRegex.exec(template)) !== null) {
    locals.add(match[1]);
  }

  return locals;
}

/**
 * Extracts all GLOBAL variable references from a Jinja2 template.
 * Uses regex to find variable uses in {{ }} expressions.
 * Excludes local variables from {% for %} and {% set %} blocks.
 * @param template The template string to analyze
 * @returns Array of variable references with paths and locations
 */
export const extractVariableReferences = async (template: string): Promise<VariableReference[]> => {
  try {
    const localVars = extractLocalVariables(template);

    // Strip comments: {# ... #}
    let cleaned = template.replace(/\{#[\s\S]*?#\}/g, '');

    // Strip tags: {% ... %}
    cleaned = cleaned.replace(/\{%[\s\S]*?%\}/g, '');

    // Match {{ expression }} — capture the inner expression
    const varRegex = /\{\{\s*([^}]+?)\s*\}\}/g;
    const results: VariableReference[] = [];
    let match;

    while ((match = varRegex.exec(cleaned)) !== null) {
      let expression = match[1].trim();

      // Remove filter expressions: "variable|filter" -> "variable"
      const pipeIndex = expression.indexOf('|');
      if (pipeIndex > 0) {
        expression = expression.substring(0, pipeIndex).trim();
      }

      // Must be a valid identifier path (letters, digits, underscores, dots)
      if (!/^[a-zA-Z_][\w.]*$/.test(expression)) continue;

      const parts = expression.split('.');
      const firstPart = parts[0];

      // Skip builtins
      if (JINJA_BUILTINS.has(firstPart)) continue;

      // Skip local variables (from for/set)
      if (localVars.has(firstPart)) continue;

      // Calculate approximate location in the original template
      const beforeMatch = template.substring(0, match.index);
      const lines = beforeMatch.split('\n');
      const row = lines.length;
      const col = (lines[lines.length - 1]?.length || 0) + 1;

      results.push({
        path: parts,
        fullPath: expression,
        location: { row, col },
      });
    }

    // Deduplicate
    const seen = new Set<string>();
    return results.filter((ref) => {
      if (seen.has(ref.fullPath)) return false;
      seen.add(ref.fullPath);
      return true;
    });
  } catch {
    return [];
  }
};

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates a Jinja2 template string.
 * Performs a quick frontend delimiter balance check and backend syntax validation.
 * @param template The template string to validate
 * @param schemaType Optional schema type for variable validation
 * @returns Object containing validity, error message, and warnings
 */
export const validateTemplate = async (
  template: string,
  schemaType?: PromptType,
): Promise<ValidationResult> => {
  // Step 1: Quick frontend delimiter balance check
  const pairs: [string, string][] = [['{{', '}}'], ['{%', '%}'], ['{#', '#}']];
  for (const [open, close] of pairs) {
    const openEscaped = open.replace(/[{}%#]/g, '\\$&');
    const closeEscaped = close.replace(/[{}%#]/g, '\\$&');
    const openCount = (template.match(new RegExp(openEscaped, 'g')) || []).length;
    const closeCount = (template.match(new RegExp(closeEscaped, 'g')) || []).length;
    if (openCount !== closeCount) {
      return {
        isValid: false,
        error: `Mismatched delimiters: ${openCount} '${open}' vs ${closeCount} '${close}'`,
        warnings: [],
      };
    }
  }

  // Step 2: Backend Jinja2 parse validation
  try {
    const response = await templateService.validate(template);
    if (!response.is_valid) {
      return {
        isValid: false,
        error: response.error || 'Template syntax error',
        warnings: [],
      };
    }
  } catch {
    // If backend is unreachable, pass with frontend checks only
  }

  // Step 3: Variable schema validation
  const warnings: Array<{
    message: string;
    line?: number;
    column?: number;
    severity: 'warning';
  }> = [];

  if (schemaType) {
    try {
      const references = await extractVariableReferences(template);
      const variableWarnings = validateVariablesAgainstSchema(references, schemaType);
      warnings.push(...variableWarnings);
    } catch {
      // Graceful degradation
    }
  }

  return {
    isValid: true,
    warnings,
  };
};

// ============================================================================
// FRAGMENT REFERENCES
// ============================================================================

/**
 * Extract all fragment references from a Jinja2 template
 * @param template The template content to analyze
 * @returns Array of fragment paths referenced via {{ prompt("...") }}
 */
export function extractFragmentReferences(template: string): string[] {
  const withoutComments = template.replace(/\{#[\s\S]*?#\}/g, '');

  const regex = /\{\{\s*prompt\s*\(\s*"([^"]+)"/g;
  const refs: string[] = [];
  let match;
  while ((match = regex.exec(withoutComments)) !== null) {
    refs.push(match[1]);
  }
  return [...new Set(refs)];
}

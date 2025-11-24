import { Liquid } from 'liquidjs';
import type { PromptData, PromptType } from './schema';
import { validateVariablesAgainstSchema } from './validator';

// Initialize LiquidJS engine
// strictVariables: false -> Allow undefined variables (render as empty string) for flexibility
// strictFilters: true -> throws error if filter is undefined
const engine = new Liquid({
  strictVariables: false,
  strictFilters: true,
  cache: true
});

/**
 * Interface for variable reference with location information
 */
export interface VariableReference {
  path: string[];  // e.g., ['variable', 'language']
  fullPath: string;  // e.g., 'variable.language'
  location?: {
    row: number;
    col: number;
  };
}

/**
 * Renders a template string with the provided data.
 * @param template The LiquidJS template string
 * @param data The data object containing 'variable', 'context', and 'state'
 * @returns The rendered string
 */
export const renderTemplate = (template: string, data: PromptData | Record<string, any>): string => {
  try {
    // parseAndRenderSync is used for synchronous rendering
    return engine.parseAndRenderSync(template, data);
  } catch (error) {
    console.error("Template rendering error:", error);
    // In case of error, return a formatted error string to make it visible in the UI
    return `[Template Error: ${error instanceof Error ? error.message : String(error)}]`;
  }
};

/**
 * Extracts all GLOBAL variable references from a template.
 * Uses LiquidJS's built-in static analysis to find global variable uses.
 * Automatically excludes local variables from {% assign %} and {% for %} tags.
 * @param template The template string to analyze
 * @returns Array of variable references with paths and locations
 */
export const extractVariableReferences = async (template: string): Promise<VariableReference[]> => {
  try {
    const parsed = engine.parse(template);
    // Use globalVariableSegments instead of variableSegments
    // This automatically filters out local variables (from assign/for tags)
    const segments = await engine.globalVariableSegments(parsed);

    const references: VariableReference[] = [];

    for (const segment of segments) {
      // segment is an array-like object with path segments
      // e.g., ['variable', 'language'] or ['context', 'recentMessages', 0]
      const pathArray = Array.isArray(segment) ? segment : Array.from(segment);

      // Process all global variables
      if (pathArray.length > 0 && typeof pathArray[0] === 'string') {
        // Convert path to strings only (ignore numeric indices for arrays)
        const stringPath = pathArray.filter((p): p is string => typeof p === 'string');

        // Skip empty paths
        if (stringPath.length > 0) {
          references.push({
            path: stringPath,
            fullPath: stringPath.join('.'),
            // LiquidJS segment objects may have location info as properties
            location: (segment as any).location
          });
        }
      }
    }

    // Remove duplicates based on fullPath
    const uniqueRefs = references.filter((ref, index, self) =>
      index === self.findIndex(r => r.fullPath === ref.fullPath)
    );

    return uniqueRefs;
  } catch (error) {
    // If parsing fails, return empty array (syntax errors will be caught by validateTemplate)
    return [];
  }
};

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

/**
 * Validates a template string syntax and optionally checks variables against schema.
 * @param template The template string to validate
 * @param schemaType Optional schema type for variable validation
 * @returns Object containing validity, error message, and warnings
 */
export const validateTemplate = async (
  template: string,
  schemaType?: PromptType
): Promise<ValidationResult> => {
  // Step 1: Validate syntax
  try {
    engine.parse(template);
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : String(error),
      warnings: []
    };
  }

  // Step 2: Validate variables if schema type is provided
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
    } catch (error) {
      // If variable validation fails, log it but don't fail the whole validation
      console.warn('Variable validation failed:', error);
    }
  }

  return {
    isValid: true,
    warnings
  };
};

export default engine;

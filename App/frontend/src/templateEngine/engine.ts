import { Liquid } from 'liquidjs';
import type { PromptData } from './schema';

// Initialize LiquidJS engine
// strictVariables: false -> Allow undefined variables (render as empty string) for flexibility
// strictFilters: true -> throws error if filter is undefined
const engine = new Liquid({
  strictVariables: false,
  strictFilters: true,
  cache: true
});

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
 * Validates a template string syntax.
 * @param template The template string to validate
 * @returns Object containing validity and error message
 */
export const validateTemplate = (template: string): { isValid: boolean; error?: string } => {
  try {
    engine.parse(template);
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
};

export default engine;

/**
 * Context for rendering templates with conditionals and variables
 */
export interface RenderContext {
  /**
   * Variables that can be referenced with {{var::key}} syntax
   */
  variables?: Record<string, string | undefined>;

  /**
   * Context data that can be referenced with {{context::key}} syntax
   */
  context?: Record<string, string | undefined>;

  /**
   * Boolean flags for conditional blocks using {{#if::flag}}...{{/if}} syntax
   * Supports negation with ! prefix: {{#if::!flag}}...{{/if}}
   */
  conditionals?: Record<string, boolean>;
}

/**
 * Template rendering utility that processes Handlebars-style conditionals and variable placeholders
 *
 * Supports:
 * - Conditional blocks: {{#if::condition}}content{{/if}}
 * - Negated conditionals: {{#if::!condition}}content{{/if}}
 * - Variable replacement: {{var::key}}
 * - Context replacement: {{context::key}}
 *
 * Processing order:
 * 1. Conditionals are evaluated first (content is kept or removed)
 * 2. Variables are replaced second (remaining placeholders are filled)
 */
export class TemplateRenderer {
  /**
   * Process conditional blocks in template
   * Removes or keeps content based on boolean flags
   *
   * @param template - Template string with conditional blocks
   * @param conditionals - Object mapping condition names to boolean values
   * @returns Template with conditionals processed
   */
  static processConditionals(template: string, conditionals: Record<string, boolean> = {}): string {
    // Match {{#if::condition}}content{{/if}} blocks
    // Also supports negation with ! prefix: {{#if::!condition}}content{{/if}}
    // Uses non-greedy matching ([\s\S]*?) to handle nested content correctly
    const conditionalRegex = /\{\{#if::(!?)([a-zA-Z0-9_-]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;

    return template.replace(conditionalRegex, (match, negation: string, conditionName: string, content: string) => {
      // Get the raw boolean value (default to false if undefined)
      const rawValue = conditionals[conditionName] ?? false;

      // Apply negation if ! prefix is present
      const shouldInclude = negation === '!' ? !rawValue : rawValue;

      return shouldInclude ? content : '';
    });
  }

  /**
   * Process variable placeholders in template
   * Replaces {{type::key}} with corresponding values
   *
   * @param template - Template string with variable placeholders
   * @param variables - Object mapping variable names to values
   * @param context - Object mapping context names to values
   * @returns Template with variables replaced
   */
  static processVariables(
    template: string,
    variables: Record<string, string | undefined> = {},
    context: Record<string, string | undefined> = {}
  ): string {
    // Match {{type::key}} patterns
    const placeholderRegex = /\{\{([a-zA-Z0-9_-]+)::([a-zA-Z0-9_.-]+)\}\}/g;

    return template.replace(placeholderRegex, (match, type: string, key: string) => {
      // Determine which group to use based on type
      let group: Record<string, string | undefined> | undefined;

      if (type === 'var') {
        group = variables;
      } else if (type === 'context') {
        group = context;
      }

      // Return the value if found, otherwise empty string
      if (!group) {
        return '';
      }

      const value = group[key];
      return value ?? '';
    });
  }

  /**
   * Render template with full context (conditionals + variables)
   *
   * Processing order:
   * 1. Process conditionals first
   * 2. Process variables second
   *
   * @param template - Template string to render
   * @param renderContext - Context containing conditionals, variables, and context data
   * @returns Fully rendered template string
   */
  static render(template: string, renderContext: RenderContext = {}): string {
    const { conditionals = {}, variables = {}, context = {} } = renderContext;

    // Step 1: Process conditionals
    let result = this.processConditionals(template, conditionals);

    // Step 2: Process variables
    result = this.processVariables(result, variables, context);

    return result;
  }

  /**
   * Validate template syntax without rendering
   * Checks for common errors like mismatched tags
   *
   * @param template - Template string to validate
   * @returns Validation result with any errors found
   */
  static validate(template: string): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for unclosed if blocks
    const openIfCount = (template.match(/\{\{#if::/g) || []).length;
    const closeIfCount = (template.match(/\{\{\/if\}\}/g) || []).length;

    if (openIfCount > closeIfCount) {
      errors.push(`Unclosed conditional blocks: ${openIfCount - closeIfCount} {{#if::...}} without {{/if}}`);
    } else if (closeIfCount > openIfCount) {
      errors.push(`Extra closing tags: ${closeIfCount - openIfCount} {{/if}} without {{#if::...}}`);
    }

    // Check for malformed variable placeholders
    // Allow #if:: with optional ! prefix, /if}}, var::, and context::
    const malformedVars = template.match(/\{\{(?!#if::!?|\/if\}\}|var::|context::)[^}]*\}\}/g);
    if (malformedVars && malformedVars.length > 0) {
      errors.push(`Malformed placeholders: ${malformedVars.join(', ')}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

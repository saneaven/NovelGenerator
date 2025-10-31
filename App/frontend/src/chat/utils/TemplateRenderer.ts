import {
  renderTemplate,
  type RenderOptions as EngineRenderOptions,
  type RenderResult as EngineRenderResult,
  type RuntimeContext,
  type TemplateDiagnostic,
} from '../../templateEngine';

/**
 * Context for rendering templates with conditionals and variables.
 */
export interface RenderContext {
  /**
   * Variables that can be referenced with {{var::key}} syntax.
   */
  variables?: Record<string, string | undefined>;

  /**
   * Context data that can be referenced with {{context::key}} syntax.
   */
  context?: Record<string, string | undefined>;

  /**
   * Boolean flags for conditional blocks using {{#if::flag}}...{{/if}} syntax.
   * Supports negation with ! prefix: {{#if::!flag}}...{{/if}}.
   */
  conditionals?: Record<string, boolean | undefined>;
}

export interface RenderOptions {
  /**
   * Template identifier used to look up placeholder metadata in the registry.
   */
  templateId?: string;

  /**
   * When true, collect structured diagnostics from the render pass.
   */
  collectDiagnostics?: boolean;
}

export interface RenderOutput {
  output: string;
  diagnostics: TemplateDiagnostic[];
}

function toRuntimeContext(renderContext: RenderContext = {}): RuntimeContext {
  return {
    variables: renderContext.variables ?? {},
    contexts: renderContext.context ?? {},
    conditionals: renderContext.conditionals ?? {},
  };
}

function toEngineOptions(options?: RenderOptions): EngineRenderOptions {
  if (!options) {
    return {};
  }

  const engineOptions: EngineRenderOptions = {};

  if (options.templateId) {
    engineOptions.templateId = options.templateId;
  }

  if (options.collectDiagnostics) {
    engineOptions.collectDiagnostics = true;
  }

  return engineOptions;
}

/**
 * Render template with diagnostics.
 */
export function renderWithDiagnostics(
  template: string,
  renderContext: RenderContext = {},
  options?: RenderOptions
): RenderOutput {
  const runtimeContext = toRuntimeContext(renderContext);
  const engineResult: EngineRenderResult = renderTemplate(template, runtimeContext, toEngineOptions(options));

  return {
    output: engineResult.output,
    diagnostics: engineResult.diagnostics,
  };
}

/**
 * Render template with provided context.
 * Falls back to legacy behaviour of returning only the rendered string.
 */
export class TemplateRenderer {
  static render(template: string, renderContext: RenderContext = {}, options?: RenderOptions): string {
    const result = renderWithDiagnostics(template, renderContext, options);

    if (options?.collectDiagnostics && result.diagnostics.length > 0) {
      console.debug('[TemplateRenderer] diagnostics', result.diagnostics);
    }

    return result.output;
  }

  static validate(
    template: string,
    options?: RenderOptions
  ): { isValid: boolean; errors: string[]; diagnostics: TemplateDiagnostic[] } {
    const result = renderWithDiagnostics(template, { variables: {}, context: {}, conditionals: {} }, options);

    const errors = result.diagnostics.filter((diag) => diag.level === 'error').map((diag) => diag.message);

    return {
      isValid: errors.length === 0,
      errors,
      diagnostics: result.diagnostics,
    };
  }
}

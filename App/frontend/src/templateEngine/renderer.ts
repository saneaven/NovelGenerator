import {
  getTemplateDefinition,
  resolveConditionalDefinition,
  resolveContextDefinition,
  resolveVariableDefinition,
} from './TemplateRegistry';
import { parseTemplate } from './parser';
import type {
  ConditionalNode,
  ParseResult,
  PlaceholderNode,
  RenderOptions,
  RenderResult,
  RuntimeContext,
  TemplateDefinition,
  TemplateDiagnostic,
  TemplateNode,
  TextNode,
} from './types';

export function renderTemplate(
  template: string,
  runtime: RuntimeContext = {},
  options: RenderOptions = {}
): RenderResult {
  const parseResult = parseTemplate(template);
  const diagnostics: TemplateDiagnostic[] = [...parseResult.diagnostics];

  const encountered = {
    variables: new Set<string>(),
    contexts: new Set<string>(),
    conditionals: new Set<string>(),
  };

  const output = renderNodes(parseResult, runtime, encountered, diagnostics, options);

  if (options.templateId) {
    validateAgainstRegistry(options.templateId, encountered, runtime, diagnostics);
  }

  return {
    output,
    diagnostics,
    encountered,
  };
}

function renderNodes(
  parseResult: ParseResult,
  runtime: RuntimeContext,
  encountered: RenderResult['encountered'],
  diagnostics: TemplateDiagnostic[],
  options: RenderOptions
): string {
  const builder: string[] = [];

  for (const node of parseResult.nodes) {
    if (node.type === 'text') {
      builder.push((node as TextNode).value);
      continue;
    }

    if (node.type === 'placeholder') {
      builder.push(
        renderPlaceholder(node as PlaceholderNode, runtime, encountered, diagnostics, options)
      );
      continue;
    }

    if (node.type === 'conditional') {
      builder.push(
        renderConditional(node as ConditionalNode, runtime, encountered, diagnostics, options)
      );
    }
  }

  return builder.join('');
}

function renderPlaceholder(
  node: PlaceholderNode,
  runtime: RuntimeContext,
  encountered: RenderResult['encountered'],
  diagnostics: TemplateDiagnostic[],
  options: RenderOptions
): string {
  const group = node.placeholderType === 'variable' ? runtime.variables : runtime.contexts;
  const value = group?.[node.name];

  if (node.placeholderType === 'variable') {
    encountered.variables.add(node.name);
  } else {
    encountered.contexts.add(node.name);
  }

  if (value === undefined || value === null) {
    diagnostics.push(createRuntimeDiagnostic('warning', `Missing value for ${node.raw}.`));
    return '';
  }

  if (typeof value !== 'string') {
    diagnostics.push(
      createRuntimeDiagnostic(
        'warning',
        `Non-string value provided for ${node.raw}; coercing via String().`
      )
    );
    return String(value);
  }

  return value;
}

function renderConditional(
  node: ConditionalNode,
  runtime: RuntimeContext,
  encountered: RenderResult['encountered'],
  diagnostics: TemplateDiagnostic[],
  options: RenderOptions
): string {
  encountered.conditionals.add(node.name);

  const conditionValue = runtime.conditionals?.[node.name];
  const conditionDef = resolveConditionalDefinition(node.name);

  if (conditionValue === undefined) {
    diagnostics.push(
      createRuntimeDiagnostic('warning', `No condition value supplied for {{#if::${node.name}}}.`)
    );
  }

  if (node.negated && conditionDef && conditionDef.supportsNegation === false) {
    diagnostics.push(
      createRuntimeDiagnostic(
        'warning',
        `Conditional {{#if::!${node.name}}} used but negation is not allowed for this flag.`
      )
    );
  }

  const boolValue = Boolean(conditionValue);
  const shouldRender = node.negated ? !boolValue : boolValue;

  if (!shouldRender) {
    return '';
  }

  const childParseResult: ParseResult = {
    nodes: node.children,
    diagnostics: [],
  };

  return renderNodes(childParseResult, runtime, encountered, diagnostics, options);
}

function validateAgainstRegistry(
  templateId: string,
  encountered: RenderResult['encountered'],
  runtime: RuntimeContext,
  diagnostics: TemplateDiagnostic[]
) {
  const definition = getTemplateDefinition(templateId);
  if (!definition) {
    diagnostics.push(createRuntimeDiagnostic('warning', `Unknown template id '${templateId}'.`));
    return;
  }

  validateRequired(definition, encountered, runtime, diagnostics);
  validateCatalog(definition, encountered, diagnostics);
}

function validateRequired(
  definition: TemplateDefinition,
  encountered: RenderResult['encountered'],
  runtime: RuntimeContext,
  diagnostics: TemplateDiagnostic[]
) {
  for (const [name, usage] of Object.entries(definition.placeholders.variables)) {
    if (!usage.required) {
      continue;
    }

    if (!encountered.variables.has(name)) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Template '${definition.id}' expects variable {{var::${name}}}.`
        )
      );
    } else if (!runtime.variables || runtime.variables[name] === undefined) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Value for {{var::${name}}} missing while rendering template '${definition.id}'.`
        )
      );
    }
  }

  for (const [name, usage] of Object.entries(definition.placeholders.contexts)) {
    if (!usage.required) {
      continue;
    }

    if (!encountered.contexts.has(name)) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Template '${definition.id}' expects context {{context::${name}}}.`
        )
      );
    } else if (!runtime.contexts || runtime.contexts[name] === undefined) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Value for {{context::${name}}} missing while rendering template '${definition.id}'.`
        )
      );
    }
  }

  for (const [name, usage] of Object.entries(definition.placeholders.conditionals)) {
    if (!usage.required) {
      continue;
    }

    if (!encountered.conditionals.has(name)) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Template '${definition.id}' expects conditional {{#if::${name}}}.`
        )
      );
    }
  }
}

function validateCatalog(
  definition: TemplateDefinition,
  encountered: RenderResult['encountered'],
  diagnostics: TemplateDiagnostic[]
) {
  for (const variable of encountered.variables) {
    if (!definition.placeholders.variables[variable]) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Variable {{var::${variable}}} is not declared for template '${definition.id}'.`
        )
      );
    } else if (!resolveVariableDefinition(variable)) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Variable {{var::${variable}}} lacks a catalog definition.`
        )
      );
    }
  }

  for (const context of encountered.contexts) {
    if (!definition.placeholders.contexts[context]) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Context {{context::${context}}} is not declared for template '${definition.id}'.`
        )
      );
    } else if (!resolveContextDefinition(context)) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Context {{context::${context}}} lacks a catalog definition.`
        )
      );
    }
  }

  for (const condition of encountered.conditionals) {
    if (!definition.placeholders.conditionals[condition]) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Conditional {{#if::${condition}}} is not declared for template '${definition.id}'.`
        )
      );
    } else if (!resolveConditionalDefinition(condition)) {
      diagnostics.push(
        createRuntimeDiagnostic(
          'warning',
          `Conditional {{#if::${condition}}} lacks a catalog definition.`
        )
      );
    }
  }
}

function createRuntimeDiagnostic(
  level: 'error' | 'warning',
  message: string,
): TemplateDiagnostic {
  return {
    level,
    message,
  };
}

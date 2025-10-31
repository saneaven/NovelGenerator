export type TemplateDiagnosticLevel = 'error' | 'warning';

export interface TemplateDiagnostic {
  level: TemplateDiagnosticLevel;
  message: string;
  line?: number;
  column?: number;
  tag?: string;
}

export interface PlaceholderDefinition {
  description: string;
  type: string;
  source: string;
  example?: string;
}

export interface ConditionalDefinition extends PlaceholderDefinition {
  supportsNegation?: boolean;
  default?: boolean;
}

export interface PlaceholderUsage {
  required?: boolean;
  notes?: string;
}

export interface TemplatePlaceholderMap {
  variables: Record<string, PlaceholderUsage>;
  contexts: Record<string, PlaceholderUsage>;
  conditionals: Record<string, PlaceholderUsage>;
}

export interface TemplateDefinition {
  id: string;
  functionType: string;
  category: string;
  variant: string;
  description: string;
  placeholders: TemplatePlaceholderMap;
}

export interface TemplateCatalog {
  variables: Record<string, PlaceholderDefinition>;
  contexts: Record<string, PlaceholderDefinition>;
  conditionals: Record<string, ConditionalDefinition>;
}

export interface TemplateRegistry {
  version: string;
  catalog: TemplateCatalog;
  templates: TemplateDefinition[];
}

export interface RuntimeContext {
  variables?: Record<string, string | undefined>;
  contexts?: Record<string, string | undefined>;
  conditionals?: Record<string, boolean | undefined>;
}

export interface RenderOptions {
  templateId?: string;
  collectDiagnostics?: boolean;
}

export interface RenderResult {
  output: string;
  diagnostics: TemplateDiagnostic[];
  encountered: {
    variables: Set<string>;
    contexts: Set<string>;
    conditionals: Set<string>;
  };
}

export type TemplateNode = TextNode | PlaceholderNode | ConditionalNode;

export interface TextNode {
  type: 'text';
  value: string;
  start: number;
  end: number;
}

export interface PlaceholderNode {
  type: 'placeholder';
  placeholderType: 'variable' | 'context';
  name: string;
  raw: string;
  start: number;
  end: number;
}

export interface ConditionalNode {
  type: 'conditional';
  name: string;
  negated: boolean;
  children: TemplateNode[];
  start: number;
  end: number;
}

export interface ParseResult {
  nodes: TemplateNode[];
  diagnostics: TemplateDiagnostic[];
}

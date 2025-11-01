import type {
  TemplateRegistry,
  TemplateDefinition,
  PlaceholderDefinition,
  ConditionalDefinition,
  PlaceholderUsage,
} from './types';
import type {
  PromptSyntaxMetadata,
  SyntaxCatalogEntry,
  TemplatePlaceholderInfo,
  TemplateSyntaxInfo,
} from '../api/promptService';

const emptyRegistry: TemplateRegistry = {
  version: '0.0.0',
  catalog: {
    variables: {},
    contexts: {},
    conditionals: {},
  },
  templates: [],
};

let cachedRegistry: TemplateRegistry = emptyRegistry;

export function setTemplateRegistry(registry: TemplateRegistry): void {
  cachedRegistry = registry;
}

function getActiveRegistry(): TemplateRegistry {
  return cachedRegistry;
}

export function getRegistry(): TemplateRegistry {
  return getActiveRegistry();
}

export function getTemplateDefinition(templateId: string): TemplateDefinition | undefined {
  return getActiveRegistry().templates.find((tpl) => tpl.id === templateId);
}

export function resolveVariableDefinition(name: string): PlaceholderDefinition | undefined {
  return getActiveRegistry().catalog.variables[name];
}

export function resolveContextDefinition(name: string): PlaceholderDefinition | undefined {
  return getActiveRegistry().catalog.contexts[name];
}

export function resolveConditionalDefinition(name: string): ConditionalDefinition | undefined {
  return getActiveRegistry().catalog.conditionals[name];
}

export function listTemplateIds(): string[] {
  return getActiveRegistry().templates.map((tpl) => tpl.id);
}

function catalogEntriesToMap(
  entries: SyntaxCatalogEntry[],
  mapConditionalExtras = false
): Record<string, PlaceholderDefinition | ConditionalDefinition> {
  return entries.reduce<Record<string, PlaceholderDefinition | ConditionalDefinition>>((acc, entry) => {
    const base: PlaceholderDefinition = {
      description: entry.description ?? '',
      type: entry.type ?? '',
      source: entry.source ?? '',
      example: entry.example,
    };

    if (mapConditionalExtras) {
      const conditional = base as ConditionalDefinition;
      conditional.supportsNegation = entry.supports_negation;
      conditional.default = entry.default as boolean | undefined;
      acc[entry.name] = conditional;
    } else {
      acc[entry.name] = base;
    }

    return acc;
  }, {});
}

function placeholdersToUsage(entries: TemplatePlaceholderInfo[]): Record<string, PlaceholderUsage> {
  return entries.reduce<Record<string, PlaceholderUsage>>((acc, entry) => {
    acc[entry.name] = {
      required: entry.required,
    };
    return acc;
  }, {});
}

function convertTemplate(template: TemplateSyntaxInfo): TemplateDefinition {
  return {
    id: template.id ?? '',
    functionType: template.function_type ?? '',
    category: template.category ?? '',
    variant: template.variant ?? '',
    description: template.description ?? '',
    placeholders: {
      variables: placeholdersToUsage(template.placeholders?.variables ?? []),
      contexts: placeholdersToUsage(template.placeholders?.contexts ?? []),
      conditionals: placeholdersToUsage(template.placeholders?.conditionals ?? []),
    },
  };
}

function metadataToRegistry(metadata: PromptSyntaxMetadata): TemplateRegistry {
  return {
    version: metadata.version ?? '0.0.0',
    catalog: {
      variables: catalogEntriesToMap(metadata.catalog?.variables ?? []) as Record<string, PlaceholderDefinition>,
      contexts: catalogEntriesToMap(metadata.catalog?.contexts ?? []) as Record<string, PlaceholderDefinition>,
      conditionals: catalogEntriesToMap(
        metadata.catalog?.conditionals ?? [],
        true
      ) as Record<string, ConditionalDefinition>,
    },
    templates: (metadata.templates ?? []).map(convertTemplate),
  };
}

export function hydrateTemplateRegistry(metadata: PromptSyntaxMetadata): TemplateRegistry {
  const registry = metadataToRegistry(metadata);
  setTemplateRegistry(registry);
  return registry;
}

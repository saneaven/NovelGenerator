import registryJson from '../../../shared/template_registry/templates.json?raw';
import type {
  TemplateRegistry,
  TemplateDefinition,
  PlaceholderDefinition,
  ConditionalDefinition,
} from './types';

let cachedRegistry: TemplateRegistry | null = null;

function loadRegistry(): TemplateRegistry {
  if (cachedRegistry) {
    return cachedRegistry;
  }

  const parsed: TemplateRegistry = JSON.parse(registryJson);
  cachedRegistry = parsed;
  return parsed;
}

export function getRegistry(): TemplateRegistry {
  return loadRegistry();
}

export function getTemplateDefinition(templateId: string): TemplateDefinition | undefined {
  return loadRegistry().templates.find((tpl) => tpl.id === templateId);
}

export function resolveVariableDefinition(name: string): PlaceholderDefinition | undefined {
  return loadRegistry().catalog.variables[name];
}

export function resolveContextDefinition(name: string): PlaceholderDefinition | undefined {
  return loadRegistry().catalog.contexts[name];
}

export function resolveConditionalDefinition(name: string): ConditionalDefinition | undefined {
  return loadRegistry().catalog.conditionals[name];
}

export function listTemplateIds(): string[] {
  return loadRegistry().templates.map((tpl) => tpl.id);
}

import type { ToolCallUiModule } from './contracts';
import callModule from '../modules/callModule';
import createModule from '../modules/createModule';
import deleteModule from '../modules/deleteModule';
import generateModule from '../modules/generateModule';
import patchModule from '../modules/patchModule';
import patchTranslationModule from '../modules/patchTranslationModule';
import readModule from '../modules/readModule';
import replaceModule from '../modules/replaceModule';
import searchModule from '../modules/searchModule';
import translateModule from '../modules/translateModule';

const REGISTERED_MODULES: ToolCallUiModule[] = [
  readModule,
  searchModule,
  createModule,
  replaceModule,
  patchModule,
  deleteModule,
  translateModule,
  patchTranslationModule,
  callModule,
  generateModule,
];

const RESOLUTION_MODULES = [...REGISTERED_MODULES].sort((a, b) => b.prefix.length - a.prefix.length);

export function resolveToolUiModule(toolName: string): ToolCallUiModule {
  for (const module of RESOLUTION_MODULES) {
    if (toolName.startsWith(module.prefix)) return module;
  }
  throw new Error(`Unknown tool UI module for tool: ${toolName}`);
}

export function getToolUiModules(): ToolCallUiModule[] {
  return [...REGISTERED_MODULES];
}

export function listAutoApproveCategories(): string[] {
  const categories: string[] = [];
  const seen = new Set<string>();
  for (const module of REGISTERED_MODULES) {
    for (const category of module.autoApproveCategories) {
      if (seen.has(category)) continue;
      categories.push(category);
      seen.add(category);
    }
  }
  return categories;
}

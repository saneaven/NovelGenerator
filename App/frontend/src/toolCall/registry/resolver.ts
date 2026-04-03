import type { ToolCallUiModule } from './contracts';
import fallbackModule from '../modules/fallbackModule';
import imageModule from '../modules/imageModule';
import manuscriptModule from '../modules/manuscriptModule';
import mcpModule from '../modules/mcpModule';
import outlineModule from '../modules/outlineModule';
import projectDataModule from '../modules/projectDataModule';
import projectTreeModule from '../modules/projectTreeModule';
import searchModule from '../modules/searchModule';
import storyEntityModule from '../modules/storyEntityModule';
import subAgentModule from '../modules/subAgentModule';
import timelineModule from '../modules/timelineModule';

const REGISTERED_MODULES: ToolCallUiModule[] = [
  projectDataModule,
  storyEntityModule,
  outlineModule,
  manuscriptModule,
  timelineModule,
  searchModule,
  projectTreeModule,
  imageModule,
  subAgentModule,
  mcpModule,
];

export function resolveToolUiModule(toolName: string): ToolCallUiModule {
  const exact = REGISTERED_MODULES.filter((module) => module.toolNames?.includes(toolName));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new Error(`Multiple exact tool UI modules registered for tool: ${toolName}`);
  }

  const dynamic = REGISTERED_MODULES.filter((module) => module.matches?.(toolName) === true);
  if (dynamic.length === 1) return dynamic[0];
  if (dynamic.length > 1) {
    throw new Error(`Multiple dynamic tool UI modules registered for tool: ${toolName}`);
  }
  return fallbackModule;
}

export function getToolUiModules(): ToolCallUiModule[] {
  return [...REGISTERED_MODULES];
}

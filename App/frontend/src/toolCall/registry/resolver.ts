import type { ToolUiSpec } from './contracts';
import callAgentSpec from './specs/callAgentSpec';
import fallbackSpec from './specs/fallbackSpec';
import objectOpsSpec from './specs/objectOpsSpec';
import patchSpec from './specs/patchSpec';
import searchSpec from './specs/searchSpec';

const SPECS: ToolUiSpec[] = [
  patchSpec,
  searchSpec,
  callAgentSpec,
  objectOpsSpec,
];

export function resolveToolUiSpec(toolName: string): ToolUiSpec {
  for (const spec of SPECS) {
    if (spec.match(toolName)) return spec;
  }
  return fallbackSpec;
}

export function getToolUiSpecs(): ToolUiSpec[] {
  return [...SPECS, fallbackSpec];
}

import type { AutoApproveCategory } from './contracts';
import { resolveToolUiSpec } from './resolver';

export function getAutoApproveCategory(toolName: string): AutoApproveCategory | null {
  return resolveToolUiSpec(toolName).getAutoApproveCategory(toolName);
}

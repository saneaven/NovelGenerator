import type { AutoApproveCategory } from './contracts';
import { listAutoApproveCategories as listRegisteredAutoApproveCategories, resolveToolUiModule } from './resolver';

export function getAutoApproveCategory(toolName: string): AutoApproveCategory | null {
  const categories = resolveToolUiModule(toolName).autoApproveCategories;
  if (categories.length === 0) return null;
  if (categories.length === 1) return categories[0];
  throw new Error(`Tool UI module for ${toolName} defines multiple auto-approve categories`);
}

export function listAutoApproveCategories(): AutoApproveCategory[] {
  return listRegisteredAutoApproveCategories();
}

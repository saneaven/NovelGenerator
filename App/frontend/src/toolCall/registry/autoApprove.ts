const AUTO_APPROVE_CATEGORIES = [
  'read',
  'write',
  'delete',
  'translate',
  'sub_agent',
  'generate',
  'mcp',
] as const;

export type AutoApproveCategory = typeof AUTO_APPROVE_CATEGORIES[number];

export function getAutoApproveCategory(toolName: string): AutoApproveCategory | null {
  if (toolName.startsWith('read_') || toolName.startsWith('search_') || toolName === 'get_project_tree') return 'read';
  if (toolName.startsWith('delete_')) return 'delete';
  if (toolName.startsWith('translate_') || toolName.startsWith('patch_translation_')) return 'translate';
  if (toolName.startsWith('call_')) return 'sub_agent';
  if (toolName.startsWith('generate_')) return 'generate';
  if (toolName.startsWith('mcp__')) return 'mcp';
  return 'write';
}

export function listAutoApproveCategories(): AutoApproveCategory[] {
  return [...AUTO_APPROVE_CATEGORIES];
}

export type TaskType = 'agent' | 'translation' | 'editAssistant' | 'imagePrompt';
export type PromptCategory = 'systemPrompt' | 'userPrompt' | 'initialUserPrompt' | 'firstUserPrompt' | 'lastUserPrompt' | 'prefill';

/**
 * Get prompt key for cache lookup
 */
export function getPromptKey(
  taskType: TaskType,
  category: PromptCategory,
  name: string
): string {
  return `${taskType}:${category}:${name}`;
}

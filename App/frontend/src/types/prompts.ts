export type TaskType = 'agent' | 'translation' | 'editAssistant' | 'imagePrompt' | 'subAgent';
export type PromptCategory =
  | 'systemPrompt'
  | 'userPrompt'
  | 'memoryPrompt'
  | 'initialUserPrompt'
  | 'firstUserPrompt'
  | 'lastUserPrompt'
  | 'prefill';

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

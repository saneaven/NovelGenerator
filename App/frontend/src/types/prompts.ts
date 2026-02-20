export type TaskType = 'agent' | 'memory' | 'translation' | 'editAssistant' | 'imagePrompt' | 'subAgent';
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
  taskSubtype: string,
  category: PromptCategory,
): string {
  return `${taskType}:${taskSubtype}:${category}`;
}

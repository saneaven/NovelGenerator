export type FunctionType = 'agent' | 'translation' | 'editAssistant' | 'imagePrompt';
export type PromptCategory = 'systemPrompt' | 'userPrompt' | 'initialUserPrompt' | 'firstUserPrompt' | 'lastUserPrompt' | 'prefill';

/**
 * Get prompt key for cache lookup
 */
export function getPromptKey(
  functionType: FunctionType,
  category: PromptCategory,
  name: string
): string {
  return `${functionType}:${category}:${name}`;
}

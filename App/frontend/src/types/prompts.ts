export type FunctionType = 'chat' | 'translation' | 'storyObjectEdit' | 'manuscriptEdit' | 'imagePrompt';
export type PromptCategory = 'systemPrompt' | 'userPrompt' | 'nonLastUserPrompt' | 'prefill';

/**
 * Get prompt key for cache lookup
 */
export function getPromptKey(
  functionType: FunctionType,
  category: PromptCategory,
  name?: string
): string {
  return name ? `${functionType}:${category}:${name}` : `${functionType}:${category}`;
}

export type FunctionType = 'chat' | 'translation' | 'storyEdit' | 'chapterGen' | 'imagePrompt';
export type PromptCategory = 'systemPrompt' | 'prefill' | 'userMessageTag' | 'userPrompt';

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

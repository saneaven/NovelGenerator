/**
 * Native Output Converter
 *
 * Converts native output from LLM responses to FunctionCallMetadata format.
 * Centralizes parsing logic that was previously scattered across modals.
 */

import type { FunctionCallMetadata } from '../llm/requestTypes';
import { parseJsonOutput, extractRawContent } from '../utils/nativeOutputParser';

/**
 * Convert native output text from LLM to FunctionCallMetadata array.
 * Handles both single object and array responses automatically.
 *
 * @param rawText - Raw text output from LLM in native output mode
 * @returns Array of FunctionCallMetadata ready for processing
 * @throws Error if parsing fails or function name is missing
 */
export function convertNativeOutputToFunctionCalls(
  rawText: string
): FunctionCallMetadata[] {
  const trimmedText = rawText.trim();
  if (!trimmedText) {
    throw new Error('AI did not generate any output.');
  }

  const cleanedText = extractRawContent(trimmedText);
  const parsedItems = parseJsonOutput(cleanedText);

  if (parsedItems.length === 0) {
    throw new Error('AI did not return valid JSON output.');
  }

  return parsedItems.map((item, index) => {
    if (!item.function) {
      throw new Error('AI response missing function name');
    }
    return {
      function_name: item.function,
      arguments: JSON.stringify(item),
      id: `native-${index}`,
      status: 'pending',
    };
  });
}

/**
 * Retry Utilities
 *
 * Handles retry logic when patch_* function calls fail.
 * When a search-replace patch cannot be applied (text not found or ambiguous),
 * these utilities help retry the LLM request forcing it to use replace_* functions instead.
 *
 * Moved from llm/patchRetryHandler.ts for better organization.
 */

import type { PatchRetryContext } from '../types';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * Configuration for patch retry
 */
export interface PatchRetryConfig {
  /** Whether auto-retry is enabled */
  enabled: boolean;
  /** Maximum number of retry attempts */
  maxRetries?: number;
}

/**
 * Result from a patch retry attempt
 */
export interface PatchRetryResult {
  success: boolean;
  retriedFields: string[];
  errors?: string[];
}

/**
 * Get the current patch retry configuration from settings
 */
export function getPatchRetryConfig(): PatchRetryConfig {
  const settings = useSettingsStore.getState().settings;
  return {
    enabled: settings.patchAutoRetry,
    maxRetries: 1, // Single retry with replace function
  };
}

/**
 * Build a retry prompt that instructs AI to use replace_* functions instead of patch_*
 *
 * @param originalPrompt - The original user prompt
 * @param retryContexts - Contexts from failed patch operations
 * @returns Modified prompt with retry instructions
 */
export function buildRetryPrompt(
  originalPrompt: string,
  retryContexts: PatchRetryContext[]
): string {
  if (retryContexts.length === 0) {
    return originalPrompt;
  }

  const fieldList = retryContexts
    .map((ctx) => {
      const objectInfo = ctx.objectType
        ? `${ctx.objectType}:${ctx.objectId}`
        : ctx.objectId;
      return `- ${ctx.fieldName} (${objectInfo}): ${ctx.error}`;
    })
    .join('\n');

  const retryInstruction = `
## IMPORTANT: Patch Operation Failed

The previous patch_* function call failed because the search text could not be found or was ambiguous.
The following fields failed to patch:

${fieldList}

**You MUST use replace_* function instead of patch_* function for these fields.**

For example:
- Instead of \`patch_story_object\`, use \`replace_story_object\`
- Instead of \`patch_chapter_outline\`, use \`replace_chapter_outline\`
- Instead of \`patch_manuscript\`, use \`replace_manuscript\`

Provide the complete new value for each failed field.
`;

  return `${originalPrompt}\n\n${retryInstruction}`;
}

/**
 * Build system prompt addition to force replace mode
 */
export function buildForceReplaceSystemPrompt(): string {
  return `
## Editing Mode: Replace Only

For this request, you MUST use replace_* functions instead of patch_* functions.
Do NOT use patch_story_object, patch_chapter_outline, or patch_manuscript.

Instead, use:
- replace_story_object - to replace story object fields
- replace_chapter_outline - to replace chapter outline fields
- replace_manuscript - to replace manuscript content
- replace_basic_info - to replace basic info fields

This ensures reliable updates without search-replace issues.
`;
}

/**
 * Check if retry should be attempted based on retry contexts
 *
 * @param retryContexts - Contexts from failed patch operations
 * @param attemptCount - Current number of retry attempts
 * @returns Whether retry should be attempted
 */
export function shouldRetry(
  retryContexts: PatchRetryContext[],
  attemptCount: number
): boolean {
  const config = getPatchRetryConfig();

  if (!config.enabled) {
    return false;
  }

  if (retryContexts.length === 0) {
    return false;
  }

  const maxRetries = config.maxRetries ?? 1;
  return attemptCount < maxRetries;
}

/**
 * Create a summary of patch failures for logging/display
 *
 * @param retryContexts - Contexts from failed patch operations
 * @returns Human-readable summary string
 */
export function summarizePatchFailures(
  retryContexts: PatchRetryContext[]
): string {
  if (retryContexts.length === 0) {
    return 'No patch failures';
  }

  const summary = retryContexts
    .map((ctx) => {
      const objectInfo = ctx.objectType
        ? `${ctx.objectType}:${ctx.objectId}`
        : ctx.objectId;
      return `${ctx.fieldName} (${objectInfo}): ${ctx.error}`;
    })
    .join('; ');

  return `Patch failed for ${retryContexts.length} field(s): ${summary}`;
}

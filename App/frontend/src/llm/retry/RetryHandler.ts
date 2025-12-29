/**
 * Retry Handler
 *
 * Handles retry prompt rendering and message serialization for the
 * unified function call retry system.
 */

import type { FunctionCallMetadata, ContentPart } from '../requestTypes';
import type { LLMTaskResult } from '../types';
import type {
  AggregatedFunctionCallResults,
  SerializedToolCall,
  SerializedAssistantMessage,
  ConversationSnapshot,
} from './types';
import { buildRetryTemplateData } from './resultAggregator';
import { useSettingsStore } from '../../store/settingsStore';
import { renderTemplate } from '../../templateEngine/engine';

/**
 * Default retry prompt template (fallback if not loaded from store)
 */
const DEFAULT_RETRY_PROMPT = `## RETRY CONTEXT - Previous Request Had Failures

{{#if retry.successResults.length}}
## Previously Successful
The following function calls succeeded and should NOT be repeated:
{{#each retry.successResults}}
- **{{functionName}}**: {{resultMessage}}
{{/each}}
{{/if}}

{{#if retry.parsingFailures.length}}
## Parsing Errors
The following function calls had invalid JSON:
{{#each retry.parsingFailures}}
- **{{functionName}}**: {{error}}
{{/each}}
Please ensure your function call arguments are valid JSON.
{{/if}}

{{#if retry.validationFailures.length}}
## Validation Errors
The following function calls failed schema validation:
{{#each retry.validationFailures}}
- **{{functionName}}**: {{error}}
{{/each}}
Please check required fields and data types.
{{/if}}

{{#if retry.applicationFailures.length}}
## Application Errors
{{#each retry.applicationFailures}}
- **{{functionName}}**: {{error}}
{{#if patchFailures}}
  Patch failures:
{{#each patchFailures}}
    - {{fieldName}} ({{objectType}}:{{objectId}}): {{error}}
{{/each}}
  **You MUST use replace_* functions instead of patch_* for these fields.**
{{/if}}
{{/each}}
{{/if}}

Please retry ONLY the failed operations, taking into account the errors above.
`;

/**
 * Load retry prompt template from store
 */
async function loadRetryPromptTemplate(): Promise<string> {
  const store = useSettingsStore.getState();

  // Try to get from cache first
  const cached = store.getPromptFromCache('common', 'userPrompt', 'functionCallRetry');
  if (cached) {
    return cached;
  }

  // Try to load from backend
  try {
    const loaded = await store.loadPrompt('common', 'userPrompt', 'functionCallRetry');
    if (loaded) {
      return loaded;
    }
  } catch (error) {
    console.warn('Failed to load retry prompt template, using default:', error);
  }

  return DEFAULT_RETRY_PROMPT;
}

/**
 * Render the retry prompt with aggregated results
 */
export async function renderRetryPrompt(
  aggregated: AggregatedFunctionCallResults
): Promise<string> {
  const template = await loadRetryPromptTemplate();
  const data = buildRetryTemplateData(aggregated);

  try {
    return renderTemplate(template, data);
  } catch (error) {
    console.error('Failed to render retry prompt:', error);
    // Fallback to a simple text summary
    return buildSimpleRetryPrompt(aggregated);
  }
}

/**
 * Build a simple text retry prompt as fallback
 */
function buildSimpleRetryPrompt(aggregated: AggregatedFunctionCallResults): string {
  const lines: string[] = ['## RETRY CONTEXT - Previous Request Had Failures\n'];

  if (aggregated.successResults.length > 0) {
    lines.push('### Previously Successful (do NOT repeat):');
    for (const r of aggregated.successResults) {
      lines.push(`- ${r.functionName}: ${r.resultMessage}`);
    }
    lines.push('');
  }

  const failures = [
    ...aggregated.parsingFailures,
    ...aggregated.validationFailures,
    ...aggregated.applicationFailures,
  ];

  if (failures.length > 0) {
    lines.push('### Failed (please retry):');
    for (const r of failures) {
      lines.push(`- ${r.functionName}: ${r.error || 'Unknown error'}`);
      if (r.patchFailures && r.patchFailures.length > 0) {
        for (const pf of r.patchFailures) {
          lines.push(`  - ${pf.fieldName}: ${pf.error}`);
        }
        lines.push('  **Use replace_* instead of patch_* for these fields.**');
      }
    }
    lines.push('');
  }

  lines.push('Please retry ONLY the failed operations.');
  return lines.join('\n');
}

/**
 * Serialize function calls to OpenAI tool_calls format
 * This is the unified format that backend providers will convert
 */
export function serializeFunctionCalls(
  functionCalls: FunctionCallMetadata[]
): SerializedToolCall[] {
  return functionCalls.map((fc) => ({
    id: fc.id,
    type: 'function' as const,
    function: {
      name: fc.function_name,
      arguments: typeof fc.arguments === 'string'
        ? fc.arguments
        : JSON.stringify(fc.arguments),
    },
  }));
}

/**
 * Build serialized assistant message with function calls
 */
export function buildSerializedAssistantMessage(
  result: LLMTaskResult
): SerializedAssistantMessage {
  // Extract text content
  const textContent = result.contentParts
    .filter((p) => p.type === 'content')
    .map((p) => p.text)
    .join('');

  const message: SerializedAssistantMessage = {
    role: 'assistant',
    content: textContent,
  };

  // Add tool_calls if present
  if (result.functionCalls && result.functionCalls.length > 0) {
    message.tool_calls = serializeFunctionCalls(result.functionCalls);
  }

  return message;
}

/**
 * Build retry user message with rendered prompt
 */
export async function buildRetryUserMessage(
  aggregated: AggregatedFunctionCallResults
): Promise<{ role: 'user'; content: string }> {
  const retryPrompt = await renderRetryPrompt(aggregated);
  return {
    role: 'user',
    content: retryPrompt,
  };
}

/**
 * Build complete retry conversation from snapshot and aggregated results
 */
export async function buildRetryConversation(
  snapshot: ConversationSnapshot,
  aggregated: AggregatedFunctionCallResults
): Promise<Array<{ role: string; content?: string; tool_calls?: SerializedToolCall[] }>> {
  const messages: Array<{ role: string; content?: string; tool_calls?: SerializedToolCall[] }> = [];

  // 1. Add original rendered messages
  for (const msg of snapshot.renderedMessages) {
    if (msg.content) {
      messages.push({ role: msg.role, content: msg.content });
    } else if (msg.contentParts) {
      const textContent = msg.contentParts
        .filter((p: ContentPart) => p.type === 'content')
        .map((p: ContentPart) => p.text)
        .join('');
      messages.push({ role: msg.role, content: textContent });
    }
  }

  // 2. Add AI's previous response with function calls
  const assistantMessage = buildSerializedAssistantMessage(snapshot.result);
  messages.push(assistantMessage);

  // 3. Add retry user message
  const retryMessage = await buildRetryUserMessage(aggregated);
  messages.push(retryMessage);

  return messages;
}

/**
 * Check if retry should be shown based on aggregated results
 */
export function shouldShowRetry(aggregated: AggregatedFunctionCallResults): boolean {
  return aggregated.failureCount > 0;
}

/**
 * Get retry button label with failure count
 */
export function getRetryButtonLabel(aggregated: AggregatedFunctionCallResults): string {
  if (aggregated.failureCount === 1) {
    return 'Retry Failed';
  }
  return `Retry Failed (${aggregated.failureCount})`;
}

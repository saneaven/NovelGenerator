/**
 * Retry System Exports
 *
 * Unified function call retry system for all LLMTask contexts.
 */

// Types
export type {
  FunctionCallFailureType,
  PatchFailureDetail,
  CategorizedFunctionCallResult,
  AggregatedFunctionCallResults,
  SerializedToolCall,
  SerializedAssistantMessage,
  ConversationSnapshot,
  RetryTemplateData,
} from './types';

// Result aggregation
export {
  categorizeFunctionCall,
  aggregateFunctionCallResults,
  shouldOfferRetry,
  getFailureCounts,
  buildRetryTemplateData,
  convertApplicationResults,
  type ApplicationResult,
  type ExtendedApplicationResult,
} from './resultAggregator';

// Retry handling
export {
  renderRetryPrompt,
  serializeFunctionCalls,
  buildSerializedAssistantMessage,
  buildRetryUserMessage,
  buildRetryConversation,
  shouldShowRetry,
  getRetryButtonLabel,
} from './RetryHandler';

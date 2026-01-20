import type { FunctionCallStatus, FunctionCallFailureType, ApplicationResult } from '../functionCall/types';

export type Role = "system" | "user" | "assistant" | "tool_results";

export type ContentPartType = "content" | "thinking";

export interface ContentPart {
  type: ContentPartType;
  text: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Tool result block for sending function call results back to the LLM.
 * Used in multi-turn conversations where the assistant made tool_calls.
 */
export interface ToolResultBlock {
  tool_call_id: string;
  function_name: string;  // Required for Gemini provider
  content: string;
}

export interface ConversationBlock {
  role: Role;
  contentParts: ContentPart[];
  tool_calls?: ToolCall[]; // for assistant messages with function calls
  tool_results?: ToolResultBlock[]; // for tool_results role messages
}

// Thinking detail from OpenRouter (model-native thinking)
export interface ThinkingDetail {
  type: 'summary' | 'text' | 'encrypted';
  summary?: string;
  text?: string;
  signature?: string;
}

// Token usage information from LLM response
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface FunctionCallMetadata {
  id: string;
  function_name: string;
  arguments: any;
  /** Current status of the function call */
  status: FunctionCallStatus;
  /** Error message (when failed) or user-provided reason (when rejected) */
  reason?: string;
  /** Type of failure when status is 'failed' */
  failureType?: FunctionCallFailureType;
  /** Result from applying the function call (when accepted) */
  result?: ApplicationResult;
  /** Timestamp when the function call was accepted */
  acceptedAt?: Date;
}

export type FunctionCallProgressStatus = 'collecting' | 'validating' | 'ready' | 'error';

export interface FunctionCallDraft {
  id: string;
  index: number;
  functionName: string;
  rawArguments: string;
  parsedArguments: any | null;
}

export interface FunctionCallOperationFieldPreview {
  key: string;
  label: string;
  value: string;
}

export interface FunctionCallOperationChapterPreview {
  name?: string;
  description?: string;
}

export interface FunctionCallReplacementPreview {
  field?: string;
  old: string;
  new: string;
}

export interface FunctionCallOperationPreview {
  key: string;
  action?: string;
  type?: string;
  id?: string;
  targetName?: string;
  summary?: string;
  data?: Record<string, any>;
  fields?: FunctionCallOperationFieldPreview[];
  chapters?: FunctionCallOperationChapterPreview[];
  missingFields?: string[];
  rawSnippet?: string;
  /** For PATCH operations - array of search/replace pairs */
  replacements?: FunctionCallReplacementPreview[];
  /** For translation operations - target language code */
  targetLanguage?: string;
  /** Indices of failed replacements (for retry context display) */
  failedReplacementIndices?: number[];
}

export interface FunctionCallProgress {
  draft: FunctionCallDraft;
  status: FunctionCallProgressStatus;
  preview?: any;
  rawPreview: string;
  operationPreviews?: FunctionCallOperationPreview[];
  error?: string;
  updatedAt: number;
}

export interface ChatMessage extends ConversationBlock {
  id: string;
  timestamp: Date;
  functionCalls?: FunctionCallMetadata[];
  thinking_details?: ThinkingDetail[];
}

/**
 * Create a minimal history with an empty user message.
 * Use this for modes that don't have chat history but need a user block
 * to trigger template rendering (e.g., agent translation).
 */
export function createEmptyUserHistory(): ChatMessage[] {
  return [{
    id: 'empty-user',
    timestamp: new Date(),
    role: 'user',
    contentParts: [{ type: 'content', text: '' }],
  }];
}


export type Role = "system" | "user" | "assistant" | "function";

export type ContentPartType = "content" | "thinking";

export interface ContentPart {
  type: ContentPartType;
  text: string;
}

export interface FunctionCall {
  name: string;
  arguments: string;
}

export interface ConversationBlock {
  role: Role;
  contentParts: ContentPart[];
  function_call?: FunctionCall;
  name?: string; // for function role messages
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
  result?: any;
  isApplied: boolean;
  isRejected?: boolean; // True if user explicitly rejected this function call
  appliedAt?: Date;
  error?: string;
  resultMessage?: string; // Human-readable result message
}

export type FunctionCallProgressStatus = 'collecting' | 'validating' | 'ready' | 'error';

export interface FunctionCallDraft {
  id: string;
  index: number;
  functionName: string;
  rawArguments: string;
  parsedArguments: any | null;
  segments: string[];
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

// Helper interface for tracking function call results systematically
export interface FunctionCallResultSummary {
  functionCallId: string;
  functionName: string;
  success: boolean;
  isRejected?: boolean; // True if user explicitly rejected this function call
  resultMessage: string;
  appliedAt: Date;
}

export interface ChatMessage extends ConversationBlock {
  id: string;
  timestamp: Date;
  functionCalls?: FunctionCallMetadata[];
  thinking_details?: ThinkingDetail[];
}

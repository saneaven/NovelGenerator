
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

// Reasoning detail from OpenRouter (model-native reasoning)
export interface ReasoningDetail {
  type: 'summary' | 'text' | 'encrypted';
  summary?: string;
  text?: string;
  signature?: string;
}

export interface FunctionCallMetadata {
  id: string;
  function_name: string;
  arguments: any;
  result?: any;
  isApplied: boolean;
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
  resultMessage: string;
  appliedAt: Date;
}

export interface ChatMessage extends ConversationBlock {
  id: string;
  timestamp: Date;
  functionCalls?: FunctionCallMetadata[];
  reasoning_details?: ReasoningDetail[];
}



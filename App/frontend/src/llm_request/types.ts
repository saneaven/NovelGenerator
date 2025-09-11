
export type Role = "system" | "user" | "assistant" | "function";

export interface FunctionCall {
  name: string;
  arguments: string;
}

export interface ConversationBlock {
  role: Role;
  content: string | null;
  function_call?: FunctionCall;
  name?: string; // for function role messages
}


export interface FunctionCallMetadata {
  id: string;
  function_name: string;
  arguments: any;
  result?: any;
  isApplied: boolean;
  appliedAt?: Date;
  error?: string;
}

export interface ChatMessage extends ConversationBlock {
  id: string;
  timestamp: Date;
  functionCalls?: FunctionCallMetadata[]; // Function calling support
}



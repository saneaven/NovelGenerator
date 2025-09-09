
export type Role = "system" | "user" | "assistant";

export interface ConversationBlock {
  role: Role;
  content: string;
}

export interface EditTagMetadata {
  id: string;
  type: 'init' | 'add' | 'edit' | 'remove';
  content: any;
  summary: string;
  isApplied: boolean;
  appliedAt?: Date;
}

export interface ChatMessage extends ConversationBlock {
  id: string;
  timestamp: Date;
  editTags?: EditTagMetadata[];
}




export type Role = "system" | "user" | "assistant";

export interface ConversationBlock {
  role: Role;
  content: string;
}

export interface ChatMessage extends ConversationBlock {
  id: string;
  timestamp: Date;
}

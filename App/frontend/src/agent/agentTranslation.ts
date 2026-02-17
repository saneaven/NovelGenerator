/**
 * Agent translation — will be reimplemented to call the backend translation endpoint.
 * Previously used the frontend LLM pipeline (startLLMSession) which is now deleted.
 */

import type { ContentPart } from '../types/chat';

export interface AgentTranslationInput {
  projectId: string;
  agentId: string;
  threadId: string;
  messageId: string;
  sourceLanguage: string;
  targetLanguage: string;
  sourceContent: string;
  originalContentParts: ContentPart[];
}

export interface AgentTranslationResult {
  agentId: string;
  messageId: string;
  targetLanguage: string;
}

export async function runAgentTranslation(
  _input: AgentTranslationInput,
  _onSessionCreated?: (sessionId: string) => void,
): Promise<string> {
  // TODO: reimplement — call backend translation endpoint via threadService
  throw new Error('Not implemented: runAgentTranslation needs backend endpoint');
}

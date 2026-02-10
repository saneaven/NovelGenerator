import type { StoredAgentMessage } from '../store/agentStore';
import type { TaskSessionState } from '../llmTask/types';
import { BLOCKING_STATUSES } from './types';

type AnySession = TaskSessionState<any, any>;

export interface ToolCallBlockingSummary {
  count: number;
  firstMessageId?: string;
}

export interface SendBlockingState {
  blocked: boolean;
  rootSessionBlocked: boolean;
  unresolvedToolCalls: ToolCallBlockingSummary;
}

export function isBlockingToolStatus(status: string | undefined): boolean {
  if (!status) return false;
  return BLOCKING_STATUSES.has(status as any);
}

export function summarizeMessageToolCallBlocking(messages: StoredAgentMessage[]): ToolCallBlockingSummary {
  let count = 0;
  let firstMessageId: string | undefined;

  for (const message of messages) {
    if (!Array.isArray(message.toolCalls) || message.toolCalls.length === 0) continue;

    for (const toolCall of message.toolCalls) {
      const status = typeof toolCall?.status === 'string' ? toolCall.status : undefined;
      if (!isBlockingToolStatus(status)) continue;

      count += 1;
      if (!firstMessageId) {
        firstMessageId = String(message.id);
      }
    }
  }

  return { count, firstMessageId };
}

function sessionHasBlockingToolStates(session: AnySession): boolean {
  const cards = Array.isArray(session.editCards) ? session.editCards : [];
  if (cards.some((card) => isBlockingToolStatus(String(card?.toolCall?.status ?? '')))) {
    return true;
  }

  const toolCalls = Array.isArray(session.toolCalls) ? session.toolCalls : [];
  if (toolCalls.some((toolCall) => isBlockingToolStatus(String(toolCall?.status ?? '')))) {
    return true;
  }

  return false;
}

export function hasRootSessionBlocker(sessions: AnySession[], selectedAgentId: string): boolean {
  return sessions.some((session) => {
    const agentId = (session.input as any)?.agentId;
    if (agentId !== selectedAgentId) return false;

    if (session.status === 'running' || session.status === 'applying' || session.status === 'pending_confirmation') {
      return true;
    }

    return sessionHasBlockingToolStates(session);
  });
}

export function getSendBlockingState(params: {
  selectedAgentId?: string;
  messages: StoredAgentMessage[];
  sessions: AnySession[];
}): SendBlockingState {
  const { selectedAgentId, messages, sessions } = params;

  if (!selectedAgentId) {
    return {
      blocked: false,
      rootSessionBlocked: false,
      unresolvedToolCalls: { count: 0 },
    };
  }

  const unresolvedToolCalls = summarizeMessageToolCallBlocking(messages);
  const rootSessionBlocked = hasRootSessionBlocker(sessions, selectedAgentId);

  return {
    blocked: rootSessionBlocked || unresolvedToolCalls.count > 0,
    rootSessionBlocked,
    unresolvedToolCalls,
  };
}

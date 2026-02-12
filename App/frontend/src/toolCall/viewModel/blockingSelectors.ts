import type { StoredAgentMessage } from '../../store/agentStore';
import type { TaskSessionState } from '../../llmTask/types';
import type { SubAgentInvocation } from '../../store/subAgentRuntimeStore';
import { BLOCKING_STATUSES } from './types';

type AnySession = TaskSessionState<unknown, unknown>;

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

export function hasRootSessionBlocker(sessions: AnySession[], selectedAgentId: string): boolean {
  return sessions.some((session) => {
    const agentId = (session.input as any)?.agentId;
    if (agentId !== selectedAgentId) return false;
    return session.status === 'running' || session.status === 'applying';
  });
}

function buildLiveParentToolCallKey(messageId: string, toolCallId: string): string {
  return `${messageId}::${toolCallId}`;
}

function collectLiveAgentParentToolCallKeys(messages: StoredAgentMessage[]): Set<string> {
  const liveKeys = new Set<string>();

  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    if (!Array.isArray(message.toolCalls) || message.toolCalls.length === 0) continue;

    const messageId = String(message.id);
    for (const toolCall of message.toolCalls) {
      const toolCallId = typeof toolCall?.id === 'string' ? String(toolCall.id) : '';
      if (!toolCallId) continue;
      liveKeys.add(buildLiveParentToolCallKey(messageId, toolCallId));
    }
  }

  return liveKeys;
}

function hasBlockingSubAgentInvocations(
  invocationsByKey: Record<string, SubAgentInvocation | undefined> | undefined,
  selectedAgentId: string,
  messages: StoredAgentMessage[]
): boolean {
  if (!invocationsByKey) return false;
  const liveParentToolCallKeys = collectLiveAgentParentToolCallKeys(messages);
  if (liveParentToolCallKeys.size === 0) return false;

  return Object.values(invocationsByKey).some((invocation) => {
    if (!invocation) return false;
    if (invocation.parentType !== 'agent') return false;
    if (invocation.parentId !== selectedAgentId) return false;
    const parentKey = buildLiveParentToolCallKey(
      String(invocation.parentMessageId),
      String(invocation.parentToolCallId)
    );
    if (!liveParentToolCallKeys.has(parentKey)) return false;
    return invocation.status === 'running' || invocation.status === 'waiting' || invocation.status === 'paused' || invocation.status === 'error';
  });
}

export function getSendBlockingState(params: {
  selectedAgentId?: string;
  messages: StoredAgentMessage[];
  sessions: AnySession[];
  invocationsByKey?: Record<string, SubAgentInvocation | undefined>;
  hasBlockingSubAgent?: boolean;
}): SendBlockingState {
  const { selectedAgentId, messages, sessions, invocationsByKey, hasBlockingSubAgent } = params;

  if (!selectedAgentId) {
    return {
      blocked: false,
      rootSessionBlocked: false,
      unresolvedToolCalls: { count: 0 },
    };
  }

  const unresolvedToolCalls = summarizeMessageToolCallBlocking(messages);
  const subAgentBlocked = typeof hasBlockingSubAgent === 'boolean'
    ? hasBlockingSubAgent
    : hasBlockingSubAgentInvocations(invocationsByKey, selectedAgentId, messages);
  const rootSessionBlocked =
    hasRootSessionBlocker(sessions, selectedAgentId) || subAgentBlocked;

  return {
    blocked: rootSessionBlocked || unresolvedToolCalls.count > 0,
    rootSessionBlocked,
    unresolvedToolCalls,
  };
}

import type { StoredAgentMessage } from '../../store/agentStore';
import type { TaskSessionState } from '../../llmTask/types';
import type { SubAgentRun } from '../../store/subAgentRuntimeStore';
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

function hasBlockingSubAgentRuns(
  runsByKey: Record<string, SubAgentRun | undefined> | undefined,
  selectedAgentId: string,
  messages: StoredAgentMessage[]
): boolean {
  if (!runsByKey) return false;
  const liveParentToolCallKeys = collectLiveAgentParentToolCallKeys(messages);
  if (liveParentToolCallKeys.size === 0) return false;

  return Object.values(runsByKey).some((run) => {
    if (!run) return false;
    if (run.parentType !== 'agent') return false;
    if (run.parentId !== selectedAgentId) return false;
    const parentKey = buildLiveParentToolCallKey(
      String(run.parentMessageId),
      String(run.parentToolCallId)
    );
    if (!liveParentToolCallKeys.has(parentKey)) return false;
    return run.status === 'running' || run.status === 'waiting' || run.status === 'paused' || run.status === 'error';
  });
}

export function getSendBlockingState(params: {
  selectedAgentId?: string;
  messages: StoredAgentMessage[];
  sessions: AnySession[];
  runsByKey?: Record<string, SubAgentRun | undefined>;
  hasBlockingSubAgent?: boolean;
}): SendBlockingState {
  const { selectedAgentId, messages, sessions, runsByKey, hasBlockingSubAgent } = params;

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
    : hasBlockingSubAgentRuns(runsByKey, selectedAgentId, messages);
  const rootSessionBlocked =
    hasRootSessionBlocker(sessions, selectedAgentId) || subAgentBlocked;

  return {
    blocked: rootSessionBlocked || unresolvedToolCalls.count > 0,
    rootSessionBlocked,
    unresolvedToolCalls,
  };
}

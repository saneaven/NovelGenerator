import type { TaskSessionState } from '../../llmTask/types';
import type { RunToolCall } from '../../runtime/types';

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

export function isBlockingRunToolStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'running';
}

export function summarizeRunToolCallBlocking(params: {
  runMessageIds: string[];
  runToolCallsByMessageId: Record<string, RunToolCall[] | undefined>;
}): ToolCallBlockingSummary {
  const { runMessageIds, runToolCallsByMessageId } = params;

  let count = 0;
  let firstMessageId: string | undefined;

  for (const messageId of runMessageIds) {
    const toolCalls = runToolCallsByMessageId[messageId] ?? [];
    for (const toolCall of toolCalls) {
      if (!isBlockingRunToolStatus(toolCall.status)) continue;
      count += 1;
      if (!firstMessageId) {
        firstMessageId = messageId;
      }
    }
  }

  return { count, firstMessageId };
}

export function hasRootSessionBlocker(sessions: AnySession[], selectedAgentId: string): boolean {
  return sessions.some((session) => {
    if (session.kind !== 'agent') return false;
    const agentId = (session.input as any)?.agentId;
    if (agentId !== selectedAgentId) return false;
    return session.status === 'running' || session.status === 'applying';
  });
}

export function getSendBlockingState(params: {
  selectedAgentId?: string;
  runMessageIds: string[];
  sessions: AnySession[];
  runToolCallsByMessageId?: Record<string, RunToolCall[] | undefined>;
}): SendBlockingState {
  const {
    selectedAgentId,
    runMessageIds,
    sessions,
    runToolCallsByMessageId,
  } = params;

  if (!selectedAgentId) {
    return {
      blocked: false,
      rootSessionBlocked: false,
      unresolvedToolCalls: { count: 0 },
    };
  }

  const unresolvedToolCalls = summarizeRunToolCallBlocking({
    runMessageIds,
    runToolCallsByMessageId: runToolCallsByMessageId ?? {},
  });

  const rootSessionBlocked = hasRootSessionBlocker(sessions, selectedAgentId);

  return {
    blocked: rootSessionBlocked || unresolvedToolCalls.count > 0,
    rootSessionBlocked,
    unresolvedToolCalls,
  };
}

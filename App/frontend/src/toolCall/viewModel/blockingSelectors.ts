import type { StoredAgentMessage } from '../../store/agentStore';
import type { TaskSessionState } from '../../llmTask/types';
import type { Run, RunToolCall } from '../../runtime/types';

type AnySession = TaskSessionState<unknown, unknown>;

type AgentMessageRunLink = {
  runId: string;
  runMessageId: string;
};

const BLOCKING_RUN_STATUSES = new Set(['running', 'waiting', 'paused', 'error']);

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
  messages: StoredAgentMessage[];
  runLinkByAgentMessageId: Record<string, AgentMessageRunLink | undefined>;
  runToolCallsByMessageId: Record<string, RunToolCall[] | undefined>;
}): ToolCallBlockingSummary {
  const { messages, runLinkByAgentMessageId, runToolCallsByMessageId } = params;

  let count = 0;
  let firstMessageId: string | undefined;

  for (const message of messages) {
    if (message.role !== 'assistant') continue;

    const link = runLinkByAgentMessageId[String(message.id)];
    if (!link) continue;

    const toolCalls = runToolCallsByMessageId[link.runMessageId] ?? [];
    for (const toolCall of toolCalls) {
      if (!isBlockingRunToolStatus(toolCall.status)) continue;
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
    if (session.kind !== 'agent') return false;
    const agentId = (session.input as any)?.agentId;
    if (agentId !== selectedAgentId) return false;
    return session.status === 'running' || session.status === 'applying';
  });
}

function hasBlockingRuns(runsById: Record<string, Run | undefined> | undefined, selectedAgentId: string): boolean {
  if (!runsById) return false;

  return Object.values(runsById).some((run) => {
    if (!run) return false;
    if (run.agentId !== selectedAgentId) return false;
    return BLOCKING_RUN_STATUSES.has(run.status);
  });
}

export function getSendBlockingState(params: {
  selectedAgentId?: string;
  messages: StoredAgentMessage[];
  sessions: AnySession[];
  runsById?: Record<string, Run | undefined>;
  runLinkByAgentMessageId?: Record<string, AgentMessageRunLink | undefined>;
  runToolCallsByMessageId?: Record<string, RunToolCall[] | undefined>;
}): SendBlockingState {
  const {
    selectedAgentId,
    messages,
    sessions,
    runsById,
    runLinkByAgentMessageId,
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
    messages,
    runLinkByAgentMessageId: runLinkByAgentMessageId ?? {},
    runToolCallsByMessageId: runToolCallsByMessageId ?? {},
  });

  const rootSessionBlocked =
    hasRootSessionBlocker(sessions, selectedAgentId) ||
    hasBlockingRuns(runsById, selectedAgentId);

  return {
    blocked: rootSessionBlocked || unresolvedToolCalls.count > 0,
    rootSessionBlocked,
    unresolvedToolCalls,
  };
}

// Backward-compatible aliases for legacy imports.
export const summarizeMessageToolCallBlocking = summarizeRunToolCallBlocking;
export const isBlockingToolStatus = isBlockingRunToolStatus;

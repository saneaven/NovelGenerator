export interface ToolCallBlockingSummary {
  count: number;
  firstMessageId?: string;
}

export type SendBlockReason = 'missing_agent' | 'running' | 'pending_tool_calls' | null;

export interface SendBlockingState {
  blocked: boolean;
  missingAgent: boolean;
  rootSessionBlocked: boolean;
  unresolvedToolCalls: ToolCallBlockingSummary;
  reason: SendBlockReason;
}

/** Any object with a `status` string works (RunToolCall, ThreadToolCall, etc.) */
type AnyToolCall = { status: string };

export function isBlockingToolCallStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'running';
}

export function summarizeToolCallBlocking(params: {
  messageIds: string[];
  toolCallsByMessageId: Record<string, AnyToolCall[] | undefined>;
}): ToolCallBlockingSummary {
  const { messageIds, toolCallsByMessageId } = params;

  let count = 0;
  let firstMessageId: string | undefined;

  for (const messageId of messageIds) {
    const toolCalls = toolCallsByMessageId[messageId] ?? [];
    for (const toolCall of toolCalls) {
      if (!isBlockingToolCallStatus(toolCall.status)) continue;
      count += 1;
      if (!firstMessageId) {
        firstMessageId = messageId;
      }
    }
  }

  return { count, firstMessageId };
}

export function getSendBlockingState(params: {
  selectedAgentId?: string;
  messageIds: string[];
  toolCallsByMessageId?: Record<string, AnyToolCall[] | undefined>;
  isThreadStreamActive?: boolean;
}): SendBlockingState {
  const {
    selectedAgentId,
    messageIds,
    toolCallsByMessageId,
    isThreadStreamActive,
  } = params;

  const missingAgent = !selectedAgentId;
  const rootSessionBlocked = Boolean(isThreadStreamActive);
  const unresolvedToolCalls = summarizeToolCallBlocking({
    messageIds,
    toolCallsByMessageId: toolCallsByMessageId ?? {},
  });
  const blocked = missingAgent || rootSessionBlocked || unresolvedToolCalls.count > 0;

  let reason: SendBlockReason = null;
  if (missingAgent) {
    reason = 'missing_agent';
  } else if (unresolvedToolCalls.count > 0) {
    reason = 'pending_tool_calls';
  } else if (rootSessionBlocked) {
    reason = 'running';
  }

  return {
    blocked,
    missingAgent,
    rootSessionBlocked,
    unresolvedToolCalls,
    reason,
  };
}

export function getSendBlockedReasonMessage(state: SendBlockingState): string | null {
  if (!state.blocked || !state.reason) return null;

  if (state.reason === 'missing_agent') {
    return 'Select an agent before sending a message.';
  }
  if (state.reason === 'pending_tool_calls') {
    return `Resolve ${state.unresolvedToolCalls.count} pending operation(s) before sending.`;
  }
  if (state.reason === 'running') {
    return 'The agent is still running or applying operations.';
  }
  return 'Resolve pending operations before sending.';
}

export interface ToolCallBlockingSummary {
  count: number;
  firstMessageId?: string;
}

export interface SendBlockingState {
  blocked: boolean;
  unresolvedToolCalls: ToolCallBlockingSummary;
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
}): SendBlockingState {
  const {
    selectedAgentId,
    messageIds,
    toolCallsByMessageId,
  } = params;

  if (!selectedAgentId) {
    return {
      blocked: false,
      unresolvedToolCalls: { count: 0 },
    };
  }

  const unresolvedToolCalls = summarizeToolCallBlocking({
    messageIds,
    toolCallsByMessageId: toolCallsByMessageId ?? {},
  });

  return {
    blocked: unresolvedToolCalls.count > 0,
    unresolvedToolCalls,
  };
}

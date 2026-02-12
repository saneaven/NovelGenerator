import type { ToolCallMetadata } from '../../llm/requestTypes';
import type { ToolCallStatus } from '../../toolCall/types';

function normalizeToolCallStatus(status: ToolCallMetadata['status']): ToolCallStatus {
  return (status ?? 'pending') as ToolCallStatus;
}

function isPendingStatus(status: ToolCallStatus): boolean {
  return status === 'pending' || status === 'validating' || status === 'processing' || status === 'running';
}

export interface ToolCallAutoContinueState {
  hasPending: boolean;
  hasRejected: boolean;
  shouldAutoContinue: boolean;
}

export function evaluateToolCallAutoContinue(toolCalls: ToolCallMetadata[]): ToolCallAutoContinueState {
  let hasPending = false;
  let hasRejected = false;

  for (const toolCall of toolCalls) {
    const status = normalizeToolCallStatus(toolCall.status);
    if (isPendingStatus(status)) hasPending = true;
    if (status === 'rejected') hasRejected = true;

    if (hasPending && hasRejected) break;
  }

  return {
    hasPending,
    hasRejected,
    shouldAutoContinue: !hasPending && !hasRejected,
  };
}

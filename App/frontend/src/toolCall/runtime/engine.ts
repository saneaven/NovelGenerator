import type { ToolCallMetadata } from '../../llm/requestTypes';
import type { ToolCallAutoApproveConfig } from '../../store/settingsStore';
import type { ToolCallDecisionMap } from '../types';
import {
  isCrudTool,
  isPatchTool,
  isReadTool,
  isReplaceTool,
} from '../schemas/schemaRegistry';


export interface ToolCallRunResult {
  status: 'pending_confirmation' | 'success' | 'error' | 'cancelled';
  toolCalls: ToolCallMetadata[];
  error?: string;
  warning?: string;
}

export function evaluateToolCallStatus(toolCalls: ToolCallMetadata[]): Omit<ToolCallRunResult, 'toolCalls'> {
  const hasPending = toolCalls.some((toolCall) => toolCall.status === 'pending' || toolCall.status === 'running');
  if (hasPending) {
    return { status: 'pending_confirmation' };
  }

  const hasAccepted = toolCalls.some((toolCall) => toolCall.status === 'accepted');
  const hasFailed = toolCalls.some((toolCall) => toolCall.status === 'failed');
  const hasRejected = toolCalls.some((toolCall) => toolCall.status === 'rejected');

  if (hasFailed && !hasAccepted) {
    const firstError = toolCalls.find((toolCall) => toolCall.status === 'failed')?.reason || 'Tool execution failed';
    return { status: 'error', error: firstError };
  }
  if (hasAccepted && (hasFailed || hasRejected)) {
    return { status: 'success', warning: 'Some actions were not applied' };
  }
  if (hasAccepted) {
    return { status: 'success' };
  }
  if (hasRejected) {
    return { status: 'cancelled' };
  }
  return { status: 'error', error: 'No applicable actions found' };
}

export function markToolCallsRunning(params: {
  toolCalls: ToolCallMetadata[];
  decisions: ToolCallDecisionMap;
}): ToolCallMetadata[] {
  const { toolCalls, decisions } = params;
  return toolCalls.map((toolCall) => {
    const decision = decisions[toolCall.id];
    if (toolCall.status !== 'pending') return toolCall;
    if (decision === 'accept') {
      return { ...toolCall, status: 'running' };
    }
    if (decision === 'reject') {
      return { ...toolCall, status: 'rejected', reason: toolCall.reason ?? 'User rejected' };
    }
    return toolCall;
  });
}

export function rejectAllToolCalls(params: {
  toolCalls: ToolCallMetadata[];
  reason?: string;
}): ToolCallRunResult {
  const { toolCalls, reason } = params;
  const nextToolCalls = toolCalls.map((toolCall) => {
    if (toolCall.status === 'pending' || toolCall.status === 'running') {
      return {
        ...toolCall,
        status: 'rejected' as const,
        reason: reason ?? toolCall.reason ?? 'User rejected',
      };
    }
    return toolCall;
  });
  return {
    ...evaluateToolCallStatus(nextToolCalls),
    toolCalls: nextToolCalls,
  };
}

function toAutoApproveCategory(toolName: string): keyof ToolCallAutoApproveConfig | null {
  if (toolName.startsWith('call_')) return 'subAgent';
  if (toolName === 'rag_search' || toolName === 'keyword_search') return 'search';
  if (isReadTool(toolName)) return 'read';
  if (isCrudTool(toolName)) return toolName.startsWith('create_') ? 'create' : 'delete';
  if (isPatchTool(toolName)) return 'patch';
  if (isReplaceTool(toolName)) return 'replace';
  return null;
}

/**
 * All-or-none auto approve policy:
 * - If any pending call is not approved by settings, returns null.
 * - Otherwise returns accept decisions for all pending calls.
 */
export function buildAutoApproveDecisions(params: {
  toolCalls: ToolCallMetadata[];
  autoApprove: ToolCallAutoApproveConfig;
}): ToolCallDecisionMap | null {
  const { toolCalls, autoApprove } = params;
  const pending = toolCalls.filter((toolCall) => toolCall.status === 'pending');
  if (pending.length === 0) return null;

  const decisions: ToolCallDecisionMap = {};
  for (const toolCall of pending) {
    const category = toAutoApproveCategory(toolCall.tool_name);
    if (!category || !autoApprove[category]) {
      return null;
    }
    decisions[toolCall.id] = 'accept';
  }
  return decisions;
}


import type { ToolCallMetadata } from '../types/chat';
import { resolveToolUiSpec } from './registry';
import type { EditCard, ToolCallStatus, ToolCallWithStatus } from './types';

export function buildEditCardsFromToolCallMetadata(toolCalls: ToolCallMetadata[]): EditCard[] {
  return toolCalls.map((tc) => {
    const args = typeof tc.arguments === 'object' && tc.arguments !== null
      ? (tc.arguments as Record<string, unknown>)
      : {};

    const spec = resolveToolUiSpec(tc.tool_name);

    const toolCallWithStatus: ToolCallWithStatus = {
      id: tc.id,
      toolName: tc.tool_name,
      arguments: args,
      status: tc.status as ToolCallStatus,
      reason: tc.reason,
      failureType: tc.failureType,
      result: tc.result,
      acceptedAt:
        tc.acceptedAt instanceof Date
          ? tc.acceptedAt
          : tc.acceptedAt
            ? new Date(tc.acceptedAt as unknown as string)
            : undefined,
    };

    return {
      id: tc.id,
      type: spec.getEditType(tc.tool_name),
      title: spec.getEditTitle(tc.tool_name, args),
      description: tc.tool_name,
      data: args,
      toolCall: toolCallWithStatus,
    };
  });
}

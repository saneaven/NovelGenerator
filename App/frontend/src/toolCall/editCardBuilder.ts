import type { ToolCallMetadata } from '../types/chat';
import { resolveToolUiModule } from './registry';
import type { EditCard, ToolCallStatus, ToolCallWithStatus } from './types';

export function buildEditCardsFromToolCallMetadata(toolCalls: ToolCallMetadata[]): EditCard[] {
  return toolCalls.flatMap((tc) => {
    const toolName = typeof tc.tool_name === 'string' ? tc.tool_name.trim() : '';
    if (!toolName) return [];

    const args = typeof tc.arguments === 'object' && tc.arguments !== null
      ? (tc.arguments as Record<string, unknown>)
      : {};

    const module = resolveToolUiModule(toolName);
    const editMeta = module.getEditMeta(toolName, args);

    const toolCallWithStatus: ToolCallWithStatus = {
      id: tc.id,
      toolName,
      arguments: args,
      status: tc.status as ToolCallStatus,
      extraContent: tc.extra_content ?? null,
      imageRunId: tc.imageRunId ?? null,
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
      type: editMeta.type,
      title: editMeta.title,
      description: toolName,
      data: args,
      toolCall: toolCallWithStatus,
    };
  });
}

/**
 * Simplified EditCard builder for displaying tool calls from stored history.
 * Does NOT depend on normalizer/validator (deleted).
 */

import type { EditCard, ToolCallWithStatus, ToolCallStatus } from './types';
import type { ToolCallMetadata } from '../types/chat';
import { useSubAgentStore } from '../store/subAgentStore';

function isCallToolName(toolName: string): boolean {
  return toolName.startsWith('call_');
}

function getToolTitle(toolName: string): string {
  if (isCallToolName(toolName)) {
    const agentName = toolName.slice(5);
    const def = agentName ? useSubAgentStore.getState().getByAgentName(agentName) : undefined;
    const label = def?.display_name ?? agentName ?? toolName;
    return `Call Sub Agent: ${label}`;
  }

  const TITLES: Record<string, string> = {
    create_story_object: 'Create Object',
    delete_story_object: 'Delete Object',
    replace_basic_info: 'Update Basic Info',
    replace_guidelines: 'Update Guidelines',
    replace_story_object: 'Update Object',
    replace_manuscript: 'Update Manuscript',
    patch_basic_info: 'Patch Basic Info',
    patch_guidelines: 'Patch Guidelines',
    patch_story_object: 'Patch Object',
    patch_manuscript: 'Patch Manuscript',
    create_outline: 'Create Outline',
    delete_outline: 'Delete Outline',
    create_outline_act: 'Create Act',
    delete_outline_act: 'Delete Act',
    create_outline_chapter: 'Create Chapter',
    delete_outline_chapter: 'Delete Chapter',
    replace_outline: 'Update Outline',
    replace_outline_act: 'Update Act',
    replace_outline_chapter: 'Update Chapter',
    patch_outline: 'Patch Outline',
    patch_outline_act: 'Patch Act',
    patch_outline_chapter: 'Patch Chapter',
    read_story_object: 'Read Object',
    read_outline: 'Read Outline Item',
    read_manuscript: 'Read Manuscript',
    rag_search: 'RAG Search',
    keyword_search: 'Keyword Search',
  };

  return TITLES[toolName] ?? `Tool: ${toolName}`;
}

function getEditType(toolName: string): string {
  if (isCallToolName(toolName)) return 'init';
  if (toolName.startsWith('create_')) return 'add';
  if (toolName.startsWith('delete_')) return 'remove';
  if (toolName.startsWith('read_') || toolName === 'rag_search' || toolName === 'keyword_search') return 'init';
  return 'edit';
}

export function buildEditCardsFromToolCallMetadata(
  toolCalls: ToolCallMetadata[]
): EditCard[] {
  return toolCalls.map((tc) => {
    const args = typeof tc.arguments === 'object' && tc.arguments !== null
      ? tc.arguments as Record<string, unknown>
      : {};

    const toolCallWithStatus: ToolCallWithStatus = {
      id: tc.id,
      toolName: tc.tool_name,
      arguments: args,
      status: tc.status as ToolCallStatus,
      reason: tc.reason,
      failureType: tc.failureType,
      result: tc.result,
      acceptedAt: tc.acceptedAt instanceof Date
        ? tc.acceptedAt
        : tc.acceptedAt
          ? new Date(tc.acceptedAt as any)
          : undefined,
    };

    return {
      id: tc.id,
      type: getEditType(tc.tool_name),
      title: getToolTitle(tc.tool_name),
      description: tc.tool_name,
      data: args,
      toolCall: toolCallWithStatus,
    };
  });
}

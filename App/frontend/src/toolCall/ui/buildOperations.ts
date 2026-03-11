import type { ToolCallProgress } from '../../types/chat';
import type { EditCard } from '../types';
import { resolveToolUiModule } from '../registry';
import type { OperationVM } from './vmTypes';

export function buildStoredOperations(cards: EditCard[]): OperationVM[] {
  return cards.map((card) => {
    const module = resolveToolUiModule(card.toolCall.toolName);
    return module.mapOperation({
      id: card.id,
      toolName: card.toolCall.toolName,
      args: card.data,
      extraContent: card.toolCall.extraContent ?? null,
      imageRunId: card.toolCall.imageRunId ?? null,
      status: card.toolCall.status,
      reason: card.toolCall.reason,
      failureType: card.toolCall.failureType,
      result: card.toolCall.result,
      source: 'stored',
    });
  });
}

function toArgs(progress: ToolCallProgress): Record<string, unknown> {
  const preview = progress.preview;
  if (preview && typeof preview === 'object' && !Array.isArray(preview)) {
    return preview as Record<string, unknown>;
  }

  const parsed = progress.draft?.parsedArguments;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  return {};
}

export function buildStreamingOperations(progressList: ToolCallProgress[]): OperationVM[] {
  const ordered = [...progressList].sort((a, b) => {
    const ai = a.draft.index;
    const bi = b.draft.index;
    if (ai !== bi) return ai - bi;
    return a.updatedAt - b.updatedAt;
  });

  return ordered.map((progress) => {
    const id = progress.draft.id;
    const toolName = progress.draft.toolName;
    const module = resolveToolUiModule(toolName);
    return module.mapOperation({
      id,
      toolName,
      args: toArgs(progress),
      extraContent: progress.draft.extraContent ?? null,
      status: progress.status,
      reason: progress.error,
      source: 'streaming',
    });
  });
}

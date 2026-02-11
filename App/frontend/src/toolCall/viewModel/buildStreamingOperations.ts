import type { ToolCallProgress } from '../../llm/requestTypes';
import type { OperationVM } from './types';
import { mapToolToOperationVM } from './toolToVm';

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
    const ai = typeof a.draft?.index === 'number' ? a.draft.index : 0;
    const bi = typeof b.draft?.index === 'number' ? b.draft.index : 0;
    if (ai !== bi) return ai - bi;
    return (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
  });

  return ordered.map((progress) => {
    const id = progress.draft?.id || `stream-${progress.draft?.index ?? 0}`;
    return mapToolToOperationVM({
      id,
      toolName: progress.draft?.toolName || 'unknown',
      args: toArgs(progress),
      status: progress.status,
      reason: progress.error,
      source: 'streaming',
    });
  });
}

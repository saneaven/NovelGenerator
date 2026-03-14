import { useCallback } from 'react';
import { decideToolCallsBatch } from '../runtime/threadCommands';
import type { ToolCallDecisionMap } from './types';

export function useToolCallDecisions(threadId: string | null) {
  const commitDecisions = useCallback(async (decisions: ToolCallDecisionMap) => {
    if (!threadId) return;
    const accepts = Object.entries(decisions)
      .filter(([, d]) => d === 'accept')
      .map(([id]) => id);
    const rejects = Object.entries(decisions)
      .filter(([, d]) => d === 'reject')
      .map(([id]) => id);
    await decideToolCallsBatch({
      threadId,
      decisions: [
        ...accepts.map((id) => ({ toolCallId: id, decision: 'accept' as const })),
        ...rejects.map((id) => ({ toolCallId: id, decision: 'reject' as const })),
      ],
      pauseAfterApply: false,
    });
  }, [threadId]);

  const commitDecisionsAndPause = useCallback(async (decisions: ToolCallDecisionMap) => {
    if (!threadId) return;
    const accepts = Object.entries(decisions)
      .filter(([, d]) => d === 'accept')
      .map(([id]) => id);
    const rejects = Object.entries(decisions)
      .filter(([, d]) => d === 'reject')
      .map(([id]) => id);
    await decideToolCallsBatch({
      threadId,
      decisions: [
        ...accepts.map((id) => ({ toolCallId: id, decision: 'accept' as const })),
        ...rejects.map((id) => ({ toolCallId: id, decision: 'reject' as const })),
      ],
      pauseAfterApply: true,
    });
  }, [threadId]);

  return { commitDecisions, commitDecisionsAndPause };
}

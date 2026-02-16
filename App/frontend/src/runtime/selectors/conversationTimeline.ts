import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useRuntimeStore } from '../store/runtimeStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import type { Run, RunMessageLangEntry } from '../types';

export interface ConversationMessage {
  id: string;
  runId: string;
  seq: number;
  role: 'user' | 'assistant' | 'system' | 'tool';
  data: Record<string, RunMessageLangEntry>;
  createdAt: string;
  /** True when this is a virtual entry representing active LLM streaming. */
  isStreaming?: boolean;
  /** Session content parts for streaming overlay. */
  streamingContentParts?: Array<{ type: string; text: string }>;
  /** Session thinking details for streaming overlay. */
  streamingThinkingDetails?: any[];
  /** Session tool call progress for streaming function calls. */
  streamingToolCallProgress?: any[];
}

/**
 * Compute flat conversation timeline from runtimeStore for a given agent.
 * Returns all RunMessages across root runs, ordered chronologically.
 * Includes a virtual "streaming" message when the latest run has an active LLM session.
 */
export function useConversationTimeline(projectId: string | undefined, agentId: string | undefined): {
  messages: ConversationMessage[];
  runMessageIds: string[];
} {
  const { runsById, runMessagesByRunId } = useRuntimeStore(
    useShallow((state) => ({
      runsById: state.runsById,
      runMessagesByRunId: state.runMessagesByRunId,
    }))
  );

  const sessions = useLLMSessionStore(
    useShallow((state) => state.sessions)
  );

  return useMemo(() => {
    if (!projectId || !agentId) {
      return { messages: [], runMessageIds: [] };
    }

    // Get all root runs for this agent, sorted by sequence
    const rootRuns: Run[] = [];
    for (const run of Object.values(runsById)) {
      if (!run) continue;
      if (run.projectId !== projectId) continue;
      if (run.agentId !== agentId) continue;
      if (run.runType !== 'agent') continue;
      rootRuns.push(run);
    }
    rootRuns.sort((a, b) => {
      const aSeq = a.rootRunSeq ?? Number.MAX_SAFE_INTEGER;
      const bSeq = b.rootRunSeq ?? Number.MAX_SAFE_INTEGER;
      if (aSeq !== bSeq) return aSeq - bSeq;
      return a.createdAt.localeCompare(b.createdAt);
    });

    // Flatten messages from all root runs
    const allMessages: ConversationMessage[] = [];
    const allMessageIds: string[] = [];

    for (const run of rootRuns) {
      const runMessages = runMessagesByRunId[run.id] ?? [];
      const sorted = [...runMessages].sort((a, b) => a.seq - b.seq);

      for (const msg of sorted) {
        allMessages.push({
          id: msg.id,
          runId: msg.runId,
          seq: msg.seq,
          role: msg.role as ConversationMessage['role'],
          data: msg.data,
          createdAt: msg.createdAt,
        });
        allMessageIds.push(msg.id);
      }
    }

    // Check for active streaming session on the latest run
    const latestRun = rootRuns[rootRuns.length - 1];
    if (latestRun?.activeSessionId) {
      const session = sessions[latestRun.activeSessionId];
      if (session && session.status === 'running') {
        // Add virtual streaming message
        allMessages.push({
          id: `streaming-${latestRun.id}`,
          runId: latestRun.id,
          seq: Number.MAX_SAFE_INTEGER,
          role: 'assistant',
          data: {},
          createdAt: new Date().toISOString(),
          isStreaming: true,
          streamingContentParts: session.contentParts as Array<{ type: string; text: string }>,
          streamingThinkingDetails: session.thinkingDetails as any[],
          streamingToolCallProgress: (session as any).toolCallProgress as any[],
        });
      }
    }

    return { messages: allMessages, runMessageIds: allMessageIds };
  }, [projectId, agentId, runsById, runMessagesByRunId, sessions]);
}

/**
 * Get all run message IDs for a given agent (used for blocking checks).
 */
export function getAgentRunMessageIds(projectId: string, agentId: string): string[] {
  const state = useRuntimeStore.getState();
  const messageIds: string[] = [];

  for (const run of Object.values(state.runsById)) {
    if (!run) continue;
    if (run.projectId !== projectId) continue;
    if (run.agentId !== agentId) continue;
    if (run.runType !== 'agent') continue;

    const messages = state.runMessagesByRunId[run.id] ?? [];
    for (const msg of messages) {
      messageIds.push(msg.id);
    }
  }

  return messageIds;
}

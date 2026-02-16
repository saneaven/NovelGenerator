import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useThreadStore, type ThreadMessage } from '../store/threadStore';

export interface ConversationMessage {
  id: string;
  threadId: string;
  runId: string;
  seq: number;
  seqInThread: number | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  data: ThreadMessage['data'];
  createdAt: string;
  /** True when this is a virtual entry representing active LLM streaming. */
  isStreaming?: boolean;
}

/**
 * Compute flat conversation timeline from threadStore for a given thread.
 * Returns all ThreadMessages ordered by seqInThread / createdAt.
 * Streaming delta messages (id starting with "delta:") are marked with isStreaming.
 */
export function useConversationTimeline(threadId: string | undefined): {
  messages: ConversationMessage[];
  messageIds: string[];
} {
  const threadMessages = useThreadStore(
    useShallow((state) => (threadId ? state.messagesByThreadId[threadId] : undefined)),
  );

  return useMemo(() => {
    if (!threadId || !threadMessages) {
      return { messages: [], messageIds: [] };
    }

    const sorted = [...threadMessages].sort((a, b) => {
      // Sort by seqInThread first (cross-run ordering), then by createdAt
      const aSit = a.seqInThread ?? Number.MAX_SAFE_INTEGER;
      const bSit = b.seqInThread ?? Number.MAX_SAFE_INTEGER;
      if (aSit !== bSit) return aSit - bSit;
      return a.createdAt.localeCompare(b.createdAt);
    });

    const allMessages: ConversationMessage[] = [];
    const allIds: string[] = [];

    for (const msg of sorted) {
      const isStreaming = msg.id.startsWith('delta:');
      allMessages.push({
        id: msg.id,
        threadId: msg.threadId,
        runId: msg.runId,
        seq: msg.seq,
        seqInThread: msg.seqInThread,
        role: msg.role,
        data: msg.data,
        createdAt: msg.createdAt,
        isStreaming,
      });
      allIds.push(msg.id);
    }

    return { messages: allMessages, messageIds: allIds };
  }, [threadId, threadMessages]);
}

/**
 * Get all message IDs for a given thread (used for blocking checks).
 */
export function getThreadMessageIds(threadId: string): string[] {
  const state = useThreadStore.getState();
  return (state.messagesByThreadId[threadId] ?? []).map((m) => m.id);
}

/**
 * @deprecated Use getThreadMessageIds instead. Kept for migration period.
 */
export function getAgentRunMessageIds(projectId: string, agentId: string): string[] {
  const state = useThreadStore.getState();
  // Find the thread for this agent
  for (const thread of Object.values(state.threadsById)) {
    if (!thread) continue;
    if (thread.projectId === projectId && thread.ownerId === agentId && thread.threadType === 'agent') {
      return (state.messagesByThreadId[thread.id] ?? []).map((m) => m.id);
    }
  }
  return [];
}

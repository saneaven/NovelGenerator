import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadInfo, ThreadToolCall } from '../types/thread';

vi.mock('../api/client', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }
  return { ApiError };
});

vi.mock('../api/threadService', () => ({
  threadService: {},
}));

import { refreshUnresolvedCount } from './threadCommands';
import { useThreadStreamStore } from '../store/threadStreamStore';

const threadId = 'thread-unresolved-1';
const runId = 'run-1';
const assistantMessageId = 'assistant-1';

function makeThread(): ThreadInfo {
  return {
    id: threadId,
    projectId: 'project-1',
    threadType: 'agent',
    status: 'running',
    unresolvedToolCallCount: 0,
  };
}

function makeStreamingToolCall(): ThreadToolCall {
  return {
    id: `streaming:${threadId}:${runId}:${assistantMessageId}:0`,
    threadId,
    runId,
    messageId: '',
    assistantMessageId,
    callSeq: 0,
    llmCallId: 'llm-1',
    toolName: 'some_tool',
    arguments: {},
    status: 'streaming',
    createdAt: '2026-06-24T00:00:00.000Z',
    updatedAt: '2026-06-24T00:00:00.000Z',
  };
}

afterEach(() => {
  useThreadStreamStore.getState().clearAll();
});

describe('deleting a message mid-stream', () => {
  it('clears the orphaned streaming tool call so the unresolved count returns to zero', () => {
    const store = useThreadStreamStore.getState();
    store.upsertThread(makeThread());
    store.upsertStreamingToolCall(makeStreamingToolCall());

    refreshUnresolvedCount(threadId);
    expect(useThreadStreamStore.getState().threadsById[threadId]?.unresolvedToolCallCount).toBe(1);

    // The two steps deleteMessage() runs for the deleted assistant message.
    useThreadStreamStore.getState().clearStreamingToolCallsForAssistant(threadId, assistantMessageId);
    refreshUnresolvedCount(threadId);
    expect(useThreadStreamStore.getState().threadsById[threadId]?.unresolvedToolCallCount).toBe(0);
  });
});

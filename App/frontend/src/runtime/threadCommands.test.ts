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
import { upsertSnapshotToolCall, removeSnapshotToolCall } from '../data/threads';
import { queryClient } from '../data/queryClient';

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
  queryClient.clear();
  useThreadStreamStore.getState().clearAll();
});

describe('deleting a message mid-stream', () => {
  it('clears the orphaned streaming tool call so the unresolved count returns to zero', () => {
    useThreadStreamStore.getState().upsertThread(makeThread());
    // Streaming tool calls live in the snapshot cache (the single source of truth).
    upsertSnapshotToolCall(makeStreamingToolCall());

    refreshUnresolvedCount(threadId);
    expect(useThreadStreamStore.getState().threadsById[threadId]?.unresolvedToolCallCount).toBe(1);

    // deleteMessage() removes the linked streaming tool call from the cache.
    removeSnapshotToolCall(threadId, makeStreamingToolCall().id);
    refreshUnresolvedCount(threadId);
    expect(useThreadStreamStore.getState().threadsById[threadId]?.unresolvedToolCallCount).toBe(0);
  });
});

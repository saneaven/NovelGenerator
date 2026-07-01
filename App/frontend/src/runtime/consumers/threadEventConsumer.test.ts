import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThreadRuntimeEvent } from '../../api/sseClient';

vi.mock('../../api/client', () => {
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

vi.mock('../../api/threadService', () => ({ threadService: {} }));

import { ThreadEventConsumer } from './threadEventConsumer';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import { queryClient } from '../../data/queryClient';
import { readThreadSnapshotFromCache } from '../../data/threads';

const threadId = 'thread-1';
const runId = 'run-1';
const messageId = 'assistant-1';
const requestId = 'req-1';

function ev(event: string, data: Record<string, unknown>): ThreadRuntimeEvent {
  return { event, data } as unknown as ThreadRuntimeEvent;
}

function seedThread() {
  useThreadStreamStore.getState().upsertThread({
    id: threadId,
    projectId: 'p-1',
    threadType: 'agent',
    status: 'running',
    unresolvedToolCallCount: 0,
  });
}

afterEach(() => {
  queryClient.clear();
  useThreadStreamStore.getState().clearAll();
});

describe('ThreadEventConsumer streaming lifecycle (single cache source)', () => {
  it('start → delta → end keeps ONE cache row and finalizes it in place', async () => {
    const consumer = new ThreadEventConsumer();
    seedThread();

    await consumer.consume(ev('message:start', {
      thread_id: threadId, run_id: runId, message_id: messageId, seq: 1, seq_in_thread: 1,
    }));

    let rows = readThreadSnapshotFromCache(threadId).messages;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(messageId);
    expect(rows[0].isStreaming).toBe(true);

    await consumer.consume(ev('content:delta', {
      thread_id: threadId, run_id: runId, message_id: messageId, request_id: requestId, text: 'Hello',
    }));

    await consumer.consume(ev('message:end', {
      thread_id: threadId, run_id: runId, message_id: messageId, request_id: requestId, seq_in_thread: 1,
      data: { English: { contentParts: [{ type: 'content', text: 'Hello world' }] } },
      tool_calls: [],
    }));

    rows = readThreadSnapshotFromCache(threadId).messages;
    expect(rows).toHaveLength(1); // same row finalized — never duplicated across two stores
    expect(rows[0].isStreaming).toBe(false);
    expect(rows[0].streamingData).toBeUndefined();
    expect(rows[0].data.English?.contentParts[0]?.text).toBe('Hello world');

    consumer.dispose();
  });

  it('start → error removes the streaming row (no stuck ghost)', async () => {
    const consumer = new ThreadEventConsumer();
    seedThread();

    await consumer.consume(ev('message:start', {
      thread_id: threadId, run_id: runId, message_id: messageId, seq: 1, seq_in_thread: 1,
    }));
    expect(readThreadSnapshotFromCache(threadId).messages).toHaveLength(1);

    await consumer.consume(ev('message:error', {
      thread_id: threadId, run_id: runId, message_id: messageId, request_id: requestId, error: 'boom',
    }));

    expect(readThreadSnapshotFromCache(threadId).messages).toHaveLength(0);

    consumer.dispose();
  });

  it('tool_call start → end swaps the temp id for the real id (no duplicate)', async () => {
    const consumer = new ThreadEventConsumer();
    seedThread();

    await consumer.consume(ev('message:start', {
      thread_id: threadId, run_id: runId, message_id: messageId, seq: 1, seq_in_thread: 1,
    }));
    await consumer.consume(ev('tool_call:start', {
      thread_id: threadId, run_id: runId, request_id: requestId,
      assistant_message_id: messageId, stream_key: 'k0', index: 0, tool_call_id: 'llm-0',
    }));

    let toolCalls = readThreadSnapshotFromCache(threadId).toolCalls;
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].id.startsWith('streaming:')).toBe(true);

    await consumer.consume(ev('tool_call:end', {
      thread_id: threadId, run_id: runId, request_id: requestId,
      assistant_message_id: messageId, stream_key: 'k0', index: 0,
      tool_call_id: 'real-tc-0', name: 'some_tool', arguments: {}, status: 'validating',
    }));

    toolCalls = readThreadSnapshotFromCache(threadId).toolCalls;
    expect(toolCalls).toHaveLength(1); // temp removed, real added — not both
    expect(toolCalls[0].id).toBe('real-tc-0');

    consumer.dispose();
  });
});

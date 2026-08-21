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

const { resumeRunMock } = vi.hoisted(() => ({
  resumeRunMock: vi.fn(),
}));

vi.mock('../../api/threadService', () => ({
  threadService: {
    resumeRun: resumeRunMock,
  },
}));

import { hasTerminalImagePromptCall, ThreadEventConsumer } from './threadEventConsumer';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import { queryClient } from '../../data/queryClient';
import {
  readThreadSnapshotFromCache,
  upsertSnapshotMessage,
  upsertSnapshotToolCall,
} from '../../data/threads';

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
  resumeRunMock.mockReset();
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

describe('image prompt terminal tool call', () => {
  it('suppresses parent auto-continue only for submit_image_prompt', () => {
    expect(hasTerminalImagePromptCall([{ toolName: 'submit_image_prompt' }])).toBe(true);
    expect(hasTerminalImagePromptCall([{ toolName: 'generate_image' }])).toBe(false);
    expect(hasTerminalImagePromptCall([])).toBe(false);
  });

  it('does not resume a done thread after the terminal call is applied', async () => {
    const consumer = new ThreadEventConsumer();
    useThreadStreamStore.getState().upsertThread({
      id: threadId,
      projectId: 'p-1',
      threadType: 'journey',
      status: 'done',
      latestRunId: runId,
      unresolvedToolCallCount: 0,
    });
    upsertSnapshotMessage({
      id: messageId,
      threadId,
      runId,
      seq: 1,
      seqInThread: 1,
      role: 'assistant',
      data: {},
      attachments: [],
      createdAt: '2026-01-01T00:00:00Z',
    });
    upsertSnapshotToolCall({
      id: 'prompt-call-1',
      threadId,
      runId,
      messageId: 'tool-message-1',
      assistantMessageId: messageId,
      callSeq: 0,
      llmCallId: 'llm-call-1',
      toolName: 'submit_image_prompt',
      arguments: { prompt: 'A stormy lighthouse.' },
      status: 'applied',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    await (consumer as unknown as { checkAutoContinue: (id: string) => Promise<void> })
      .checkAutoContinue(threadId);

    expect(resumeRunMock).not.toHaveBeenCalled();
    consumer.dispose();
  });
});

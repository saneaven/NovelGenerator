import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubEnv('VITE_API_URL', 'http://localhost');
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
});

const { extractImagePromptResultFromThread, parseImagePromptToolArguments } = await import('./imagePromptResult');
const { upsertSnapshotToolCall } = await import('../data/threads');
const { useThreadStreamStore } = await import('../store/threadStreamStore');
const { queryClient } = await import('../data/queryClient');

afterEach(() => {
  queryClient.clear();
  useThreadStreamStore.getState().clearAll();
});

describe('submit_image_prompt arguments', () => {
  it('parses a natural prompt result', () => {
    expect(parseImagePromptToolArguments('natural', { prompt: 'A lighthouse in a storm.' })).toEqual({
      promptFormat: 'natural',
      prompt: 'A lighthouse in a storm.',
    });
  });

  it('parses a complete positive/negative result in one call', () => {
    expect(parseImagePromptToolArguments('positive_negative', {
      positive: 'lighthouse, storm, dramatic light',
      negative: 'blurry, low contrast',
    })).toEqual({
      promptFormat: 'positive_negative',
      positive: 'lighthouse, storm, dramatic light',
      negative: 'blurry, low contrast',
    });
  });

  it('parses NovelAI base and ordered character prompts in one call', () => {
    expect(parseImagePromptToolArguments('novelai', {
      positive: '2girls, windswept coast',
      negative: 'lowres',
      characters: [
        { positive: 'red hair, raincoat', negative: 'hat' },
        { positive: 'black hair, sailor uniform', negative: '' },
      ],
    })).toEqual({
      promptFormat: 'novelai',
      positive: '2girls, windswept coast',
      negative: 'lowres',
      characters: [
        { positive: 'red hair, raincoat', negative: 'hat' },
        { positive: 'black hair, sailor uniform', negative: '' },
      ],
    });
  });

  it('rejects incomplete data for the requested format', () => {
    expect(parseImagePromptToolArguments('positive_negative', { positive: 'portrait' })).toBeNull();
    expect(parseImagePromptToolArguments('novelai', {
      positive: 'portrait',
      negative: '',
      characters: [{ positive: '', negative: '' }],
    })).toBeNull();
  });

  it('reads only an applied submit call from the current run', () => {
    const threadId = 'journey-thread-1';
    useThreadStreamStore.getState().upsertThread({
      id: threadId,
      projectId: 'project-1',
      threadType: 'journey',
      status: 'done',
      latestRunId: 'run-current',
    });
    const seedToolCall = (
      id: string,
      runId: string,
      status: 'pending' | 'applied',
      prompt: string,
    ) => upsertSnapshotToolCall({
      id,
      threadId,
      runId,
      messageId: `${id}-message`,
      assistantMessageId: `${id}-assistant`,
      callSeq: 0,
      llmCallId: `${id}-llm`,
      toolName: 'submit_image_prompt',
      arguments: { prompt },
      status,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });

    seedToolCall('stale-applied', 'run-stale', 'applied', 'Stale prompt');
    seedToolCall('current-pending', 'run-current', 'pending', 'Unapplied prompt');
    seedToolCall('current-applied', 'run-current', 'applied', 'Current prompt');

    expect(extractImagePromptResultFromThread(threadId, 'natural')).toEqual({
      promptFormat: 'natural',
      prompt: 'Current prompt',
    });
  });
});

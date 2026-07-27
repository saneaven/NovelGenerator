import { describe, expect, it } from 'vitest';
import {
  chunkTranslationItems,
  resolveTranslationChunkSize,
  startTranslationGroupsConcurrently,
} from './translationBatching';

describe('translationBatching', () => {
  it('keeps the original order while chunking', () => {
    expect(chunkTranslationItems([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2],
      [3, 4],
      [5],
    ]);
  });

  it('creates one chunk per object when the size is one', () => {
    expect(chunkTranslationItems(['a', 'b', 'c'], 1)).toEqual([
      ['a'],
      ['b'],
      ['c'],
    ]);
  });

  it('returns no chunks for an empty selection', () => {
    expect(chunkTranslationItems([], 10)).toEqual([]);
  });

  it('clamps preset and custom sizes to the current selection', () => {
    expect(resolveTranslationChunkSize('10', 1, 4)).toBe(4);
    expect(resolveTranslationChunkSize('custom', 3, 10)).toBe(3);
    expect(resolveTranslationChunkSize('custom', 0, 10)).toBe(1);
    expect(resolveTranslationChunkSize('custom', undefined, 10)).toBe(1);
  });

  it('starts every group before waiting for any group to finish', async () => {
    const started: number[] = [];
    const resolvers: Array<() => void> = [];

    const pending = startTranslationGroupsConcurrently(
      [[1], [2], [3]],
      async ([value]) => {
        started.push(value);
        await new Promise<void>((resolve) => {
          resolvers.push(resolve);
        });
      },
    );

    expect(started).toEqual([1, 2, 3]);
    resolvers.forEach((resolve) => resolve());
    await expect(pending).resolves.toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ]);
  });

  it('keeps successful group results when another group fails', async () => {
    const results = await startTranslationGroupsConcurrently(
      [[1], [2], [3]],
      async ([value]) => {
        if (value === 2) throw new Error('failed');
      },
    );

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
    ]);
  });
});

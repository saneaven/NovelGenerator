import { describe, expect, it } from 'vitest';
import {
  addNovelAICharacterPrompt,
  deleteNovelAICharacterPrompt,
  moveNovelAICharacterPrompt,
} from './novelAICharacterPromptList';

const characters = [
  { positive: 'red hair', negative: 'hat' },
  { positive: 'black hair', negative: 'glasses' },
];

describe('NovelAI character prompt cards', () => {
  it('adds a blank character card without mutating existing cards', () => {
    const next = addNovelAICharacterPrompt(characters);
    expect(next).toEqual([...characters, { positive: '', negative: '' }]);
    expect(characters).toHaveLength(2);
  });

  it('deletes the selected character card', () => {
    expect(deleteNovelAICharacterPrompt(characters, 0)).toEqual([characters[1]]);
  });

  it('reorders character cards while preserving their prompt pairs', () => {
    expect(moveNovelAICharacterPrompt(characters, 1, -1)).toEqual([characters[1], characters[0]]);
    expect(moveNovelAICharacterPrompt(characters, 0, -1)).toBe(characters);
  });
});

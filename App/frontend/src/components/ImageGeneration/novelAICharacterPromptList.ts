import type { NovelAICharacterPrompt } from '../../domain/imagePrompt';

export function addNovelAICharacterPrompt(
  characters: NovelAICharacterPrompt[],
): NovelAICharacterPrompt[] {
  return [...characters, { positive: '', negative: '' }];
}

export function deleteNovelAICharacterPrompt(
  characters: NovelAICharacterPrompt[],
  index: number,
): NovelAICharacterPrompt[] {
  return characters.filter((_, characterIndex) => characterIndex !== index);
}

export function moveNovelAICharacterPrompt(
  characters: NovelAICharacterPrompt[],
  index: number,
  offset: -1 | 1,
): NovelAICharacterPrompt[] {
  const destination = index + offset;
  if (destination < 0 || destination >= characters.length) return characters;
  const next = [...characters];
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

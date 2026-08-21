import { getMergedThreadView } from '../data/threads';
import type { ImagePromptResult, NovelAICharacterPrompt, PromptFormat } from '../domain/imagePrompt';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readRequiredString(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] as string : null;
}

export function parseImagePromptToolArguments(
  promptFormat: PromptFormat,
  value: unknown,
): ImagePromptResult | null {
  const argumentsRecord = readRecord(value);
  if (!argumentsRecord) return null;

  if (promptFormat === 'natural') {
    const prompt = readRequiredString(argumentsRecord, 'prompt');
    return prompt?.trim() ? { promptFormat, prompt } : null;
  }

  const positive = readRequiredString(argumentsRecord, 'positive');
  const negative = readRequiredString(argumentsRecord, 'negative');
  if (!positive?.trim() || negative === null) return null;

  if (promptFormat === 'positive_negative') {
    return { promptFormat, positive, negative };
  }

  if (!Array.isArray(argumentsRecord.characters)) return null;
  const characters: NovelAICharacterPrompt[] = [];
  for (const valueCharacter of argumentsRecord.characters) {
    const character = readRecord(valueCharacter);
    if (!character) return null;
    const characterPositive = readRequiredString(character, 'positive');
    const characterNegative = readRequiredString(character, 'negative');
    if (!characterPositive?.trim() || characterNegative === null) return null;
    characters.push({ positive: characterPositive, negative: characterNegative });
  }
  return { promptFormat, positive, negative, characters };
}

export function extractImagePromptResultFromThread(
  threadId: string,
  promptFormat: PromptFormat,
): ImagePromptResult | null {
  const view = getMergedThreadView(threadId);
  const latestRunId = view.thread?.latestRunId ?? null;
  if (!latestRunId) return null;
  const matchingCalls = Object.values(view.toolCallsById)
    .filter((toolCall) => (
      toolCall?.toolName === 'submit_image_prompt'
      && toolCall.runId === latestRunId
      && toolCall.status === 'applied'
    ))
    .sort((left, right) => (right?.callSeq ?? 0) - (left?.callSeq ?? 0));

  for (const toolCall of matchingCalls) {
    const parsed = parseImagePromptToolArguments(promptFormat, toolCall?.arguments);
    if (parsed) return parsed;
  }
  return null;
}

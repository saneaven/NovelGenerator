export type PromptFormat = 'natural' | 'positive_negative' | 'novelai';

export interface NovelAICharacterPrompt {
  positive: string;
  negative: string;
}

export interface StoredImagePrompts {
  natural: {
    prompt: string;
  };
  positive_negative: {
    positive: string;
    negative: string;
  };
  novelai: {
    positive: string;
    negative: string;
    characters: NovelAICharacterPrompt[];
  };
}

export type ImagePromptResult =
  | {
      promptFormat: 'natural';
      prompt: string;
    }
  | {
      promptFormat: 'positive_negative';
      positive: string;
      negative: string;
    }
  | {
      promptFormat: 'novelai';
      positive: string;
      negative: string;
      characters: NovelAICharacterPrompt[];
    };

export function createEmptyStoredImagePrompts(): StoredImagePrompts {
  return {
    natural: { prompt: '' },
    positive_negative: { positive: '', negative: '' },
    novelai: { positive: '', negative: '', characters: [] },
  };
}

export function normalizeStoredImagePrompts(value: unknown): StoredImagePrompts {
  const empty = createEmptyStoredImagePrompts();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return empty;

  const record = value as Record<string, unknown>;
  const natural = readRecord(record.natural);
  const positiveNegative = readRecord(record.positive_negative);
  const novelai = readRecord(record.novelai);
  const rawCharacters = Array.isArray(novelai.characters) ? novelai.characters : [];

  return {
    natural: {
      prompt: readString(natural.prompt),
    },
    positive_negative: {
      positive: readString(positiveNegative.positive),
      negative: readString(positiveNegative.negative),
    },
    novelai: {
      positive: readString(novelai.positive),
      negative: readString(novelai.negative),
      characters: rawCharacters.map((character) => {
        const item = readRecord(character);
        return {
          positive: readString(item.positive),
          negative: readString(item.negative),
        };
      }),
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

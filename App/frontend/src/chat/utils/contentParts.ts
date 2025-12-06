import type { ContentPart } from '../../llm/requestTypes';

export interface CollapseContentPartsOptions {
  contentSeparator?: string;
  thinkingSeparator?: string;
  trim?: boolean;
}

export interface CollapsedContentParts {
  content: string;
  thinking: string;
}

const defaultOptions: Required<CollapseContentPartsOptions> = {
  contentSeparator: '',
  thinkingSeparator: '\n\n',
  trim: false,
};

export function collapseContentParts(
  parts: ContentPart[] | undefined,
  options?: CollapseContentPartsOptions
): CollapsedContentParts {
  const { contentSeparator, thinkingSeparator, trim } = {
    ...defaultOptions,
    ...options,
  };

  const buckets: Record<'content' | 'thinking', string[]> = {
    content: [],
    thinking: [],
  };

  (parts ?? []).forEach((part) => {
    if (!part || !part.type) return;
    if (part.type === 'content') buckets.content.push(part.text ?? '');
    if (part.type === 'thinking') buckets.thinking.push(part.text ?? '');
  });

  const joinAndMaybeTrim = (values: string[], separator: string) => {
    const joined = values.join(separator);
    return trim ? joined.trim() : joined;
  };

  return {
    content: joinAndMaybeTrim(buckets.content, contentSeparator),
    thinking: joinAndMaybeTrim(buckets.thinking, thinkingSeparator),
  };
}

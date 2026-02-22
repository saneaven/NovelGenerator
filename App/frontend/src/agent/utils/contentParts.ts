import type { ContentPart } from '../../types/chat';

export interface CollapseContentPartsOptions {
  contentSeparator?: string;
  trim?: boolean;
}

export interface CollapsedContentParts {
  content: string;
}

const defaultOptions: Required<CollapseContentPartsOptions> = {
  contentSeparator: '',
  trim: false,
};

export function collapseContentParts(
  parts: ContentPart[] | undefined,
  options?: CollapseContentPartsOptions
): CollapsedContentParts {
  const { contentSeparator, trim } = {
    ...defaultOptions,
    ...options,
  };

  const contentChunks: string[] = [];

  (parts ?? []).forEach((part) => {
    if (!part || !part.type) return;
    if (part.type === 'content') contentChunks.push(part.text ?? '');
  });

  const joinAndMaybeTrim = (values: string[], separator: string) => {
    const joined = values.join(separator);
    return trim ? joined.trim() : joined;
  };

  return {
    content: joinAndMaybeTrim(contentChunks, contentSeparator),
  };
}

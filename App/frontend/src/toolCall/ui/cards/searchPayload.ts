import type { SearchType } from '../vmTypes';

export interface SearchPayloadEntry {
  text: string;
  fieldPath?: string;
  chunkIndex?: number | null;
  distance?: number | null;
}

export interface SearchPayloadGroup {
  objectType: string;
  objectId: string;
  displayName: string;
  entries: SearchPayloadEntry[];
}

export interface SearchPayload {
  type: SearchType;
  keyword?: string;
  queries?: string[];
  page?: number;
  pageSize?: number;
  total?: number;
  groups: SearchPayloadGroup[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function parseStructuredPayload(value: unknown): SearchPayload | null {
  if (!isRecord(value)) return null;

  const type = value.type === 'keyword' ? 'keyword' : value.type === 'rag' ? 'rag' : null;
  if (!type) return null;

  const rawGroups = Array.isArray(value.groups) ? value.groups : [];
  const groups: SearchPayloadGroup[] = rawGroups
    .map((group): SearchPayloadGroup | null => {
      if (!isRecord(group)) return null;
      if (typeof group.objectType !== 'string' || typeof group.objectId !== 'string') return null;

      const rawEntries = Array.isArray(group.entries) ? group.entries : [];
      const entries: SearchPayloadEntry[] = rawEntries
        .map((entry): SearchPayloadEntry | null => {
          if (!isRecord(entry)) return null;
          if (typeof entry.text !== 'string') return null;
          return {
            text: entry.text,
            fieldPath: typeof entry.fieldPath === 'string' ? entry.fieldPath : undefined,
            chunkIndex: typeof entry.chunkIndex === 'number' ? entry.chunkIndex : null,
            distance: typeof entry.distance === 'number' ? entry.distance : null,
          };
        })
        .filter((entry): entry is SearchPayloadEntry => Boolean(entry));

      return {
        objectType: group.objectType,
        objectId: group.objectId,
        displayName:
          typeof group.displayName === 'string' && group.displayName.trim()
            ? group.displayName
            : group.objectId,
        entries,
      };
    })
    .filter((group): group is SearchPayloadGroup => Boolean(group));

  return {
    type,
    keyword: typeof value.keyword === 'string' ? value.keyword : undefined,
    queries: toStringArray(value.queries),
    page: typeof value.page === 'number' ? value.page : undefined,
    pageSize: typeof value.pageSize === 'number' ? value.pageSize : undefined,
    total: typeof value.total === 'number' ? value.total : undefined,
    groups,
  };
}

function parseTextFallback(text: string, fallbackType: SearchType): SearchPayload | null {
  if (!text.trim()) return null;

  const groupRegex = /<object\s+type="([^"]+)"\s+id="([^"]+)"\s*>\s*([\s\S]*?)<\/object>/g;
  const resultRegex = /<result>\s*([\s\S]*?)\s*<\/result>/g;

  const groups: SearchPayloadGroup[] = [];
  let match: RegExpExecArray | null;

  while ((match = groupRegex.exec(text)) !== null) {
    const [, objectType, objectId, inner] = match;
    const lines = inner
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const displayName = lines[0] || objectId;
    const entries: SearchPayloadEntry[] = [];

    let resultMatch: RegExpExecArray | null;
    while ((resultMatch = resultRegex.exec(inner)) !== null) {
      entries.push({ text: resultMatch[1].trim() });
    }

    groups.push({ objectType, objectId, displayName, entries });
  }

  if (groups.length === 0) return null;

  return {
    type: fallbackType,
    groups,
  };
}

export function extractSearchPayload(params: {
  resultData?: Record<string, unknown>;
  resultMessage?: string;
  fallbackType: SearchType;
}): SearchPayload | null {
  const { resultData, resultMessage, fallbackType } = params;

  const structured = parseStructuredPayload(resultData?.searchPayload);
  if (structured) return structured;

  if (typeof resultMessage === 'string') {
    return parseTextFallback(resultMessage, fallbackType);
  }

  return null;
}

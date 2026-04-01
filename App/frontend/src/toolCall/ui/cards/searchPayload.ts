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
  pattern?: string;
  caseSensitive?: boolean;
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

  const type = value.type === 'regex' ? 'regex' : value.type === 'semantic' ? 'semantic' : null;
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
    pattern: typeof value.pattern === 'string' ? value.pattern : undefined,
    caseSensitive: value.caseSensitive === true,
    queries: toStringArray(value.queries),
    page: typeof value.page === 'number' ? value.page : undefined,
    pageSize: typeof value.pageSize === 'number' ? value.pageSize : undefined,
    total: typeof value.total === 'number' ? value.total : undefined,
    groups,
  };
}

export function extractSearchPayload(params: {
  resultData?: Record<string, unknown>;
}): SearchPayload | null {
  return parseStructuredPayload(params.resultData?.searchPayload);
}

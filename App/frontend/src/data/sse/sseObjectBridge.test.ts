import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { objectKeys } from '../keys/objectKeys';
import type { queryClient as queryClientSingleton } from '../queryClient';
import type {
  markObjectStaleFromSSE as markObjectStaleFromSSEFn,
  removeObjectFromCacheFromSSE as removeObjectFromCacheFromSSEFn,
  writeObjectToCacheFromSSE as writeObjectToCacheFromSSEFn,
} from './sseObjectBridge';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';

let queryClient: typeof queryClientSingleton;
let markObjectStaleFromSSE: typeof markObjectStaleFromSSEFn;
let removeObjectFromCacheFromSSE: typeof removeObjectFromCacheFromSSEFn;
let writeObjectToCacheFromSSE: typeof writeObjectToCacheFromSSEFn;

type InvalidateSpy = {
  mock: {
    calls: unknown[][];
  };
};

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', 'http://api.test');
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  ({ queryClient } = await import('../queryClient'));
  ({ markObjectStaleFromSSE, removeObjectFromCacheFromSSE, writeObjectToCacheFromSSE } = await import('./sseObjectBridge'));
});

afterEach(() => {
  queryClient?.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function makeObject(params: {
  id: string;
  type: ObjectType;
  projectId?: string;
  language?: string;
  data?: Record<string, unknown>;
  kind?: UnifiedObject['kind'];
  version?: number;
}): UnifiedObject {
  const language = params.language ?? 'Korean';
  return {
    id: params.id,
    type: params.type,
    kind: params.kind,
    metadata: {
      id: params.id,
      project_id: params.projectId ?? 'project-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    data: params.data ?? {},
    language_state: {
      requested_language: language,
      content_language: language,
      fallback_to: null,
      available_languages: [language],
      has_requested_language: true,
      is_fallback: false,
    },
    version: {
      id: `version-${params.version ?? 1}`,
      number: params.version ?? 1,
      created_at: '2026-01-01T00:00:00Z',
    },
  };
}

function sameKey(left: readonly unknown[] | undefined, right: readonly unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasInvalidateCall(
  spy: InvalidateSpy,
  queryKey: readonly unknown[],
  refetchType?: 'none',
): boolean {
  return spy.mock.calls.some(([filters]) => {
    const candidate = filters as { queryKey?: readonly unknown[]; refetchType?: unknown };
    return sameKey(candidate.queryKey, queryKey) && candidate.refetchType === refetchType;
  });
}

function hasActiveRefetchCall(
  spy: InvalidateSpy,
  queryKey: readonly unknown[],
): boolean {
  return spy.mock.calls.some(([filters]) => {
    const candidate = filters as { queryKey?: readonly unknown[]; refetchType?: unknown };
    return sameKey(candidate.queryKey, queryKey) && candidate.refetchType !== 'none';
  });
}

describe('sseObjectBridge', () => {
  it('patches updated detail and collection caches without active collection refetch', async () => {
    const projectId = 'project-1';
    const id = 'manuscript-1';
    const oldObject = makeObject({
      id,
      type: 'manuscript',
      projectId,
      data: { wordCount: 10 },
      version: 1,
    });
    const updated = makeObject({
      id,
      type: 'manuscript',
      projectId,
      data: { wordCount: 20 },
      version: 2,
    });
    const detail = objectKeys.detail('manuscript', id, 'Korean', 'tiptap');
    const collection = objectKeys.collection(projectId, 'manuscript', 'Korean', 'tiptap', 'summary');
    const collectionPrefix = objectKeys.collectionType(projectId, 'manuscript');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    queryClient.setQueryData(detail, oldObject);
    queryClient.setQueryData(collection, [oldObject]);

    await writeObjectToCacheFromSSE(updated, null, 'Korean', 'updated', 'tiptap');

    expect(queryClient.getQueryData(detail)).toEqual(updated);
    expect(queryClient.getQueryData<UnifiedObject[]>(collection)?.[0]).toEqual(updated);
    expect(hasInvalidateCall(invalidateSpy, collectionPrefix, 'none')).toBe(true);
    expect(hasActiveRefetchCall(invalidateSpy, collectionPrefix)).toBe(false);
  });

  it('patches markdown sibling projections when the SSE consumer fetched them', async () => {
    const projectId = 'project-1';
    const id = 'outline-1';
    const tiptapObject = makeObject({
      id,
      type: 'outline',
      projectId,
      data: { name: 'Chapter', content: { type: 'doc', content: [] } },
      kind: 'chapter',
      version: 2,
    });
    const markdownObject = makeObject({
      id,
      type: 'outline',
      projectId,
      data: { name: 'Chapter', content: 'Updated markdown' },
      kind: 'chapter',
      version: 2,
    });
    const markdownDetail = objectKeys.detail('outline', id, 'Korean', 'markdown');
    const markdownCollection = objectKeys.collection(projectId, 'outline', 'Korean', 'markdown', 'full');

    queryClient.setQueryData(markdownCollection, [
      makeObject({ id, type: 'outline', projectId, data: { content: 'Old markdown' }, kind: 'chapter' }),
    ]);

    await writeObjectToCacheFromSSE(tiptapObject, markdownObject, 'Korean', 'updated', 'tiptap');

    expect(queryClient.getQueryData(markdownDetail)).toEqual(markdownObject);
    expect(queryClient.getQueryData<UnifiedObject[]>(markdownCollection)?.[0]).toEqual(markdownObject);
  });

  it('patches story entity tree rows in place', async () => {
    const projectId = 'project-1';
    const id = 'entity-1';
    const folder = makeObject({ id: 'folder-1', type: 'story_entity_folder', projectId });
    const oldEntity = makeObject({
      id,
      type: 'story_entity',
      projectId,
      kind: 'character',
      data: { name: 'Old Name' },
      version: 1,
    });
    const updatedEntity = makeObject({
      id,
      type: 'story_entity',
      projectId,
      kind: 'character',
      data: { name: 'New Name' },
      version: 2,
    });
    const tree = objectKeys.storyTree(projectId, 'Korean', 'markdown', 'summary');
    const treePrefix = objectKeys.storyTreesOf(projectId);
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    queryClient.setQueryData(tree, { folders: [folder], entities: [oldEntity] });

    await writeObjectToCacheFromSSE(updatedEntity, null, 'Korean', 'updated', 'markdown');

    const cached = queryClient.getQueryData<{ folders: UnifiedObject[]; entities: UnifiedObject[] }>(tree);
    expect(cached?.folders).toEqual([folder]);
    expect(cached?.entities).toEqual([updatedEntity]);
    expect(hasInvalidateCall(invalidateSpy, treePrefix, 'none')).toBe(true);
    expect(hasActiveRefetchCall(invalidateSpy, treePrefix)).toBe(false);
  });

  it('allows active collection refetch for created objects because membership changed', async () => {
    const projectId = 'project-1';
    const id = 'outline-new';
    const created = makeObject({ id, type: 'outline', projectId, kind: 'chapter' });
    const collectionPrefix = objectKeys.collectionType(projectId, 'outline');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await writeObjectToCacheFromSSE(created, null, 'Korean', 'created', 'tiptap');

    expect(queryClient.getQueryData(objectKeys.detail('outline', id, 'Korean', 'tiptap'))).toEqual(created);
    expect(hasActiveRefetchCall(invalidateSpy, collectionPrefix)).toBe(true);
  });

  it('removes deleted objects from cached details and collections without active refetch', async () => {
    const projectId = 'project-1';
    const id = 'outline-1';
    const target = makeObject({ id, type: 'outline', projectId, kind: 'chapter' });
    const other = makeObject({ id: 'outline-2', type: 'outline', projectId, kind: 'chapter' });
    const detail = objectKeys.detail('outline', id, 'Korean', 'tiptap');
    const collection = objectKeys.collection(projectId, 'outline', 'Korean', 'tiptap', 'summary');
    const collectionPrefix = objectKeys.collectionType(projectId, 'outline');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    queryClient.setQueryData(detail, target);
    queryClient.setQueryData(objectKeys.versions('outline', id), [{ id: 'version-1' }]);
    queryClient.setQueryData(collection, [target, other]);

    await removeObjectFromCacheFromSSE({ type: 'outline', id, projectId });

    expect(queryClient.getQueryData(detail)).toBeUndefined();
    expect(queryClient.getQueryData(objectKeys.versions('outline', id))).toBeUndefined();
    expect(queryClient.getQueryData<UnifiedObject[]>(collection)).toEqual([other]);
    expect(hasInvalidateCall(invalidateSpy, collectionPrefix, 'none')).toBe(true);
    expect(hasActiveRefetchCall(invalidateSpy, collectionPrefix)).toBe(false);
  });

  it('marks projections stale with refetchType none for fetch-failure fallback', async () => {
    const projectId = 'project-1';
    const id = 'event-1';
    const collectionPrefix = objectKeys.collectionType(projectId, 'timeline_event');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await markObjectStaleFromSSE({ type: 'timeline_event', id, projectId });

    expect(hasInvalidateCall(invalidateSpy, objectKeys.detailOf('timeline_event', id), 'none')).toBe(true);
    expect(hasInvalidateCall(invalidateSpy, collectionPrefix, 'none')).toBe(true);
    expect(hasInvalidateCall(invalidateSpy, objectKeys.versions('timeline_event', id), 'none')).toBe(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { objectKeys } from '../keys/objectKeys';
import type { queryClient as queryClientSingleton } from '../queryClient';
import type { invalidateObjectFromSSE as invalidateObjectFromSSEFn } from './sseObjectBridge';

let queryClient: typeof queryClientSingleton;
let invalidateObjectFromSSE: typeof invalidateObjectFromSSEFn;

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', 'http://api.test');
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  ({ queryClient } = await import('../queryClient'));
  ({ invalidateObjectFromSSE } = await import('./sseObjectBridge'));
});

afterEach(() => {
  queryClient?.clear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('invalidateObjectFromSSE', () => {
  it('removes every detail projection and invalidates every collection projection for updated objects', async () => {
    const projectId = 'project-1';
    const id = 'manuscript-1';
    const koreanDetail = objectKeys.detail('manuscript', id, 'Korean', 'tiptap');
    const englishDetail = objectKeys.detail('manuscript', id, 'English', 'markdown');
    const koreanCollection = objectKeys.collection(projectId, 'manuscript', 'Korean', 'tiptap', 'full');
    const englishSummary = objectKeys.collection(projectId, 'manuscript', 'English', 'markdown', 'summary');
    const versions = objectKeys.versions('manuscript', id);

    queryClient.setQueryData(koreanDetail, { id, language: 'Korean' });
    queryClient.setQueryData(englishDetail, { id, language: 'English' });
    queryClient.setQueryData(koreanCollection, [{ id, language: 'Korean' }]);
    queryClient.setQueryData(englishSummary, [{ id, language: 'English' }]);
    queryClient.setQueryData(versions, [{ id: 'version-1' }]);

    await invalidateObjectFromSSE({
      type: 'manuscript',
      id,
      projectId,
      action: 'updated',
    });

    expect(queryClient.getQueryData(koreanDetail)).toBeUndefined();
    expect(queryClient.getQueryData(englishDetail)).toBeUndefined();
    expect(queryClient.getQueryState(koreanCollection)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(englishSummary)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(versions)?.isInvalidated).toBe(true);
  });

  it('invalidates timeline collections without caring about language or rich-text format', async () => {
    const projectId = 'project-1';
    const id = 'event-1';
    const detail = objectKeys.detail('timeline_event', id, 'Japanese', 'tiptap');
    const markdownCollection = objectKeys.collection(projectId, 'timeline_event', 'Japanese', 'markdown', 'full');
    const tiptapCollection = objectKeys.collection(projectId, 'timeline_event', 'Korean', 'tiptap', 'summary');

    queryClient.setQueryData(detail, { id });
    queryClient.setQueryData(markdownCollection, [{ id }]);
    queryClient.setQueryData(tiptapCollection, [{ id }]);

    await invalidateObjectFromSSE({
      type: 'timeline_event',
      id,
      projectId,
      action: 'updated',
    });

    expect(queryClient.getQueryData(detail)).toBeUndefined();
    expect(queryClient.getQueryState(markdownCollection)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(tiptapCollection)?.isInvalidated).toBe(true);
  });

  it('invalidates story trees for story entity objects', async () => {
    const projectId = 'project-1';
    const id = 'entity-1';
    const detail = objectKeys.detail('story_entity', id, 'Korean', 'tiptap');
    const koreanTree = objectKeys.storyTree(projectId, 'Korean', 'markdown', 'full');
    const englishTree = objectKeys.storyTree(projectId, 'English', 'tiptap', 'summary');

    queryClient.setQueryData(detail, { id });
    queryClient.setQueryData(koreanTree, { folders: [], entities: [{ id }] });
    queryClient.setQueryData(englishTree, { folders: [], entities: [{ id }] });

    await invalidateObjectFromSSE({
      type: 'story_entity',
      id,
      projectId,
      action: 'updated',
    });

    expect(queryClient.getQueryData(detail)).toBeUndefined();
    expect(queryClient.getQueryState(koreanTree)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(englishTree)?.isInvalidated).toBe(true);
  });

  it('uses the same global invalidation policy for deleted objects', async () => {
    const projectId = 'project-1';
    const id = 'outline-1';
    const detail = objectKeys.detail('outline', id, 'Korean', 'tiptap');
    const collection = objectKeys.collection(projectId, 'outline', 'English', 'markdown', 'summary');
    const versions = objectKeys.versions('outline', id);

    queryClient.setQueryData(detail, { id });
    queryClient.setQueryData(collection, [{ id }]);
    queryClient.setQueryData(versions, [{ id: 'version-1' }]);

    await invalidateObjectFromSSE({
      type: 'outline',
      id,
      projectId,
      action: 'deleted',
    });

    expect(queryClient.getQueryData(detail)).toBeUndefined();
    expect(queryClient.getQueryState(collection)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(versions)?.isInvalidated).toBe(true);
  });

  it('does not seed a detail cache for created objects', async () => {
    const projectId = 'project-1';
    const id = 'entity-1';
    const detail = objectKeys.detail('story_entity_folder', id, 'Korean', 'markdown');
    const tree = objectKeys.storyTree(projectId, 'Korean', 'markdown', 'full');

    queryClient.setQueryData(tree, { folders: [], entities: [] });

    await invalidateObjectFromSSE({
      type: 'story_entity_folder',
      id,
      projectId,
      action: 'created',
    });

    expect(queryClient.getQueryData(detail)).toBeUndefined();
    expect(queryClient.getQueryState(tree)?.isInvalidated).toBe(true);
  });
});

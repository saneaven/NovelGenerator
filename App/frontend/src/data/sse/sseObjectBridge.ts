/**
 * SSE → QueryClient bridge for unified objects.
 *
 * Object change events are language-agnostic, but refetching every active
 * language/format projection after each update creates request storms. The SSE
 * consumer fetches the changed projection once, then these helpers patch cached
 * lists in place and mark sibling projections stale without active refetches.
 */

import { queryClient } from '../queryClient';
import { objectKeys, type ObjectCollectionVariant, type ObjectRichTextFormat } from '../keys/objectKeys';
import { defaultRichTextFormatForType, isStoryEntityTreeType } from '../../domain/objectFormat';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';

export type ObjectChangeAction = 'created' | 'updated' | 'deleted';

type StoryEntityTreeCache = {
  folders: UnifiedObject[];
  entities: UnifiedObject[];
};

const COLLECTION_VARIANTS: readonly ObjectCollectionVariant[] = ['full', 'summary'];

function resolveLanguage(object: UnifiedObject, fallback: string): string {
  return object.language_state?.requested_language || fallback;
}

function collectionPrefix(projectId: string, type: ObjectType) {
  return isStoryEntityTreeType(type)
    ? objectKeys.storyTreesOf(projectId)
    : objectKeys.collectionType(projectId, type);
}

function patchObjectInList(list: UnifiedObject[], object: UnifiedObject): UnifiedObject[] | null {
  const index = list.findIndex((item) => item.id === object.id);
  if (index < 0) return null;
  const next = list.slice();
  next[index] = object;
  return next;
}

function removeObjectFromList(list: UnifiedObject[], id: string): UnifiedObject[] | null {
  const next = list.filter((item) => item.id !== id);
  return next.length === list.length ? null : next;
}

function patchCollectionProjection(
  projectId: string,
  type: ObjectType,
  language: string,
  format: ObjectRichTextFormat,
  object: UnifiedObject,
): void {
  for (const variant of COLLECTION_VARIANTS) {
    const key = objectKeys.collection(projectId, type, language, format, variant);
    const existing = queryClient.getQueryData<UnifiedObject[]>(key);
    if (!existing) continue;
    const next = patchObjectInList(existing, object);
    if (next) queryClient.setQueryData(key, next);
  }
}

function patchStoryTreeProjection(
  projectId: string,
  language: string,
  format: ObjectRichTextFormat,
  object: UnifiedObject,
): void {
  const field = object.type === 'story_entity_folder' ? 'folders' : 'entities';

  for (const variant of COLLECTION_VARIANTS) {
    const key = objectKeys.storyTree(projectId, language, format, variant);
    const existing = queryClient.getQueryData<StoryEntityTreeCache>(key);
    if (!existing) continue;
    const nextItems = patchObjectInList(existing[field] ?? [], object);
    if (!nextItems) continue;
    queryClient.setQueryData(key, { ...existing, [field]: nextItems });
  }
}

function patchCachedProjection(
  projectId: string,
  language: string,
  format: ObjectRichTextFormat,
  object: UnifiedObject,
): void {
  if (isStoryEntityTreeType(object.type)) {
    patchStoryTreeProjection(projectId, language, format, object);
    return;
  }
  patchCollectionProjection(projectId, object.type, language, format, object);
}

function removeFromCachedCollections(projectId: string, type: ObjectType, id: string): void {
  const entries = queryClient.getQueriesData<UnifiedObject[]>({
    queryKey: objectKeys.collectionType(projectId, type),
  });

  for (const [queryKey, data] of entries) {
    if (!data) continue;
    const next = removeObjectFromList(data, id);
    if (next) queryClient.setQueryData(queryKey, next);
  }
}

function removeFromCachedStoryTrees(projectId: string, id: string): void {
  const entries = queryClient.getQueriesData<StoryEntityTreeCache>({
    queryKey: objectKeys.storyTreesOf(projectId),
  });

  for (const [queryKey, data] of entries) {
    if (!data) continue;
    const folders = removeObjectFromList(data.folders ?? [], id);
    const entities = removeObjectFromList(data.entities ?? [], id);
    if (!folders && !entities) continue;
    queryClient.setQueryData(queryKey, {
      ...data,
      folders: folders ?? data.folders,
      entities: entities ?? data.entities,
    });
  }
}

/** Mark affected projections stale without triggering active refetches. */
export async function markObjectStaleFromSSE(params: {
  type: ObjectType;
  id: string;
  projectId: string;
}): Promise<void> {
  const { type, id, projectId } = params;
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: objectKeys.detailOf(type, id), refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: collectionPrefix(projectId, type), refetchType: 'none' }),
    queryClient.invalidateQueries({ queryKey: objectKeys.versions(type, id), refetchType: 'none' }),
  ]);
}

/** Write an SSE-fetched object projection into detail and list/tree caches. */
export async function writeObjectToCacheFromSSE(
  object: UnifiedObject,
  markdownObject: UnifiedObject | null,
  fallbackLanguage: string,
  action: Extract<ObjectChangeAction, 'created' | 'updated'> = 'updated',
  formatOverride?: ObjectRichTextFormat,
): Promise<void> {
  const language = resolveLanguage(object, fallbackLanguage);
  const format = formatOverride ?? defaultRichTextFormatForType(object.type);
  const projectId = object.metadata?.project_id;

  queryClient.setQueryData(objectKeys.detail(object.type, object.id, language, format), object);

  if (markdownObject) {
    const markdownLanguage = resolveLanguage(markdownObject, language);
    queryClient.setQueryData(objectKeys.detail(object.type, object.id, markdownLanguage, 'markdown'), markdownObject);
  }

  if (typeof projectId !== 'string') {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: objectKeys.detailOf(object.type, object.id), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: objectKeys.versions(object.type, object.id), refetchType: 'none' }),
    ]);
    return;
  }

  if (action === 'created') {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: collectionPrefix(projectId, object.type) }),
      queryClient.invalidateQueries({ queryKey: objectKeys.detailOf(object.type, object.id), refetchType: 'none' }),
      queryClient.invalidateQueries({ queryKey: objectKeys.versions(object.type, object.id), refetchType: 'none' }),
    ]);
    return;
  }

  patchCachedProjection(projectId, language, format, object);

  if (markdownObject) {
    const markdownLanguage = resolveLanguage(markdownObject, language);
    patchCachedProjection(projectId, markdownLanguage, 'markdown', markdownObject);
  }

  await markObjectStaleFromSSE({
    type: object.type,
    id: object.id,
    projectId,
  });
}

/** Remove a deleted object from cached details and cached list/tree rows. */
export async function removeObjectFromCacheFromSSE(params: {
  type: ObjectType;
  id: string;
  projectId: string;
}): Promise<void> {
  const { type, id, projectId } = params;

  queryClient.removeQueries({ queryKey: objectKeys.detailOf(type, id) });
  queryClient.removeQueries({ queryKey: objectKeys.versions(type, id) });

  if (isStoryEntityTreeType(type)) {
    removeFromCachedStoryTrees(projectId, id);
  } else {
    removeFromCachedCollections(projectId, type, id);
  }

  await queryClient.invalidateQueries({ queryKey: collectionPrefix(projectId, type), refetchType: 'none' });
}

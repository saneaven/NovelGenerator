/**
 * SSE → QueryClient bridge for unified objects.
 *
 * Replaces unifiedObjectStore.applyObjectChanges. The ObjectEventConsumer keeps
 * its batching / per-key revision dedup / current-project guard; only the
 * terminal cache write changes.
 *
 * Upserts: write the fetched object into its detail cache (tiptap + markdown
 * siblings), then reflect it in the owning collection — patched in place if the
 * object already exists (no refetch storm), or invalidated if new (so the
 * collection refetches to include it). This preserves the old "only invalidate
 * collections for NEW objects" optimization.
 */

import { queryClient } from '../queryClient';
import { objectKeys } from '../keys/objectKeys';
import { defaultRichTextFormatForType, isStoryEntityTreeType } from '../../domain/objectFormat';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';

function resolveLanguage(object: UnifiedObject, fallback: string): string {
  return object.language_state?.requested_language || fallback;
}

function patchOrInvalidateCollection(
  projectId: string,
  type: ObjectType,
  language: string,
  format: 'tiptap' | 'markdown',
  object: UnifiedObject,
): void {
  // Touch both the full and summary variants of the collection. The summary
  // variant lacks heavy content, but writing the (content-bearing) SSE object
  // into it is harmless — summary consumers only read labels/metadata.
  for (const variant of ['full', 'summary'] as const) {
    const key = objectKeys.collection(projectId, type, language, format, variant);
    const existing = queryClient.getQueryData<UnifiedObject[]>(key);
    if (!existing) continue; // not cached → nothing mounted; will fetch fresh on mount
    const index = existing.findIndex((o) => o.id === object.id);
    if (index >= 0) {
      const next = existing.slice();
      next[index] = object;
      queryClient.setQueryData(key, next);
    } else {
      queryClient.invalidateQueries({ queryKey: key });
    }
  }
}

/** Write an SSE-fetched object (+ optional markdown variant) into the cache. */
export function writeObjectToCacheFromSSE(
  object: UnifiedObject,
  markdownObject: UnifiedObject | null,
  fallbackLanguage: string,
): void {
  const language = resolveLanguage(object, fallbackLanguage);
  const format = defaultRichTextFormatForType(object.type);
  queryClient.setQueryData(objectKeys.detail(object.type, object.id, language, format), object);
  if (markdownObject) {
    queryClient.setQueryData(objectKeys.detail(object.type, object.id, language, 'markdown'), markdownObject);
  }

  const projectId = object.metadata?.project_id;
  if (typeof projectId !== 'string') return;

  if (isStoryEntityTreeType(object.type)) {
    queryClient.invalidateQueries({ queryKey: objectKeys.storyTreeLang(projectId, language) });
  } else {
    patchOrInvalidateCollection(projectId, object.type, language, format, object);
    if (markdownObject) {
      patchOrInvalidateCollection(projectId, object.type, language, 'markdown', markdownObject);
    }
  }
}

/** Drop a deleted object from the cache and refresh its owning collection / tree. */
export function removeObjectFromCacheFromSSE(params: {
  type: ObjectType;
  id: string;
  projectId: string;
}): void {
  const { type, id, projectId } = params;
  queryClient.removeQueries({ queryKey: objectKeys.detailOf(type, id) });
  if (isStoryEntityTreeType(type)) {
    queryClient.invalidateQueries({ queryKey: objectKeys.storyTreesOf(projectId) });
  } else {
    queryClient.invalidateQueries({ queryKey: objectKeys.collectionType(projectId, type) });
  }
}

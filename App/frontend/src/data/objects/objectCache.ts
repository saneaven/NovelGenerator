/**
 * Synchronous reads of cached objects for NON-React code (journey/preview
 * builders, label resolvers) that previously called
 * `useUnifiedObjectStore.getState()`.
 *
 * These only see what queries have already fetched — same fragility as the old
 * flat objects map. Prefer the query hooks inside React components.
 */

import { queryClient } from '../queryClient';
import { objectKeys } from '../keys/objectKeys';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';

/**
 * All cached objects for a project (across every cached collection + story tree,
 * any language/format), deduped by id. Language-agnostic by design — builders
 * just need the set of objects that exist.
 */
export function readProjectObjectsFromCache(projectId: string): UnifiedObject[] {
  const byId = new Map<string, UnifiedObject>();

  const collections = queryClient.getQueriesData<UnifiedObject[]>({
    queryKey: objectKeys.collectionsOf(projectId),
  });
  for (const [, data] of collections) {
    if (data) for (const obj of data) byId.set(obj.id, obj);
  }

  const trees = queryClient.getQueriesData<{ folders: UnifiedObject[]; entities: UnifiedObject[] }>({
    queryKey: objectKeys.storyTreesOf(projectId),
  });
  for (const [, data] of trees) {
    if (data) {
      for (const obj of data.folders) byId.set(obj.id, obj);
      for (const obj of data.entities) byId.set(obj.id, obj);
    }
  }

  return [...byId.values()];
}

/** A single cached object by type+id, searching any cached language/format. Null if not cached. */
export function readObjectFromCache(type: ObjectType, id: string): UnifiedObject | null {
  const matches = queryClient.getQueriesData<UnifiedObject>({ queryKey: objectKeys.detailOf(type, id) });
  for (const [, data] of matches) {
    if (data) return data;
  }
  return null;
}

/** A single cached object by id alone (type unknown), scanning every cached object query. */
export function readAnyObjectFromCache(id: string): UnifiedObject | null {
  const entries = queryClient.getQueriesData<unknown>({ queryKey: objectKeys.all });
  for (const [, data] of entries) {
    if (!data) continue;
    if (Array.isArray(data)) {
      const found = (data as UnifiedObject[]).find((o) => o?.id === id);
      if (found) return found;
      continue;
    }
    if (typeof data === 'object') {
      const obj = data as UnifiedObject;
      if (obj.id === id) return obj;
      const tree = data as { folders?: UnifiedObject[]; entities?: UnifiedObject[] };
      if (tree.folders || tree.entities) {
        const found = [...(tree.folders ?? []), ...(tree.entities ?? [])].find((o) => o?.id === id);
        if (found) return found;
      }
    }
  }
  return null;
}

/**
 * Reactive id→object map for a project, replacing the old
 * `useUnifiedObjectStore(s => s.objects)` flat map that display components
 * (tool-call cards, lookups) subscribed to.
 *
 * Aggregates the project's collections + story tree into a Record by id.
 * Every verified consumer of this map reads only labels (name/title) and
 * structural metadata (parent_id/kind/chapter_id/...), never the rich-text
 * `content`. So it fetches the **summary** projection (backend
 * include_content=false) — far smaller payloads, cached separately from any
 * full-content collection. Query keys are shared, so multiple consumers dedupe.
 */

import { useMemo } from 'react';
import type { ObjectRichTextFormat } from '../keys/objectKeys';
import type { UnifiedObject } from '../../types/unifiedObject';
import { useObjectCollectionQuery } from './useObjectCollectionQuery';
import { useStoryEntityTreeQuery } from './useStoryEntityTreeQuery';

export interface ProjectObjectsMapState {
  objects: Record<string, UnifiedObject>;
  isLoading: boolean;
}

export function useProjectObjectsMapState(
  projectId: string | undefined,
  language: string,
  format: ObjectRichTextFormat = 'markdown',
): ProjectObjectsMapState {
  const basicInfo = useObjectCollectionQuery(projectId, 'basic_info', language, format, true);
  const guidelines = useObjectCollectionQuery(projectId, 'guidelines', language, format, true);
  const outline = useObjectCollectionQuery(projectId, 'outline', language, format, true);
  const manuscript = useObjectCollectionQuery(projectId, 'manuscript', language, format, true);
  const tracks = useObjectCollectionQuery(projectId, 'timeline_track', language, format, true);
  const events = useObjectCollectionQuery(projectId, 'timeline_event', language, format, true);
  const tree = useStoryEntityTreeQuery(projectId, language, format, true);

  const objects = useMemo(() => {
    const map: Record<string, UnifiedObject> = {};
    const lists: Array<UnifiedObject[] | undefined> = [
      basicInfo.data,
      guidelines.data,
      outline.data,
      manuscript.data,
      tracks.data,
      events.data,
      tree.data?.folders,
      tree.data?.entities,
    ];
    for (const list of lists) {
      if (!list) continue;
      for (const obj of list) map[obj.id] = obj;
    }
    return map;
  }, [
    basicInfo.data,
    guidelines.data,
    outline.data,
    manuscript.data,
    tracks.data,
    events.data,
    tree.data,
  ]);

  const isLoading = basicInfo.isLoading
    || guidelines.isLoading
    || outline.isLoading
    || manuscript.isLoading
    || tracks.isLoading
    || events.isLoading
    || tree.isLoading;

  return useMemo(() => ({ objects, isLoading }), [objects, isLoading]);
}

export function useProjectObjectsMap(
  projectId: string | undefined,
  language: string,
  format: ObjectRichTextFormat = 'markdown',
): Record<string, UnifiedObject> {
  return useProjectObjectsMapState(projectId, language, format).objects;
}

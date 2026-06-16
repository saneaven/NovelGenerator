/**
 * Reactive id→object map for a project, replacing the old
 * `useUnifiedObjectStore(s => s.objects)` flat map that display components
 * (tool-call cards, lookups) subscribed to.
 *
 * Fetches the project's collections + story tree in markdown format (so
 * `data.content` is rendered markdown text), aggregated into a Record by id.
 * Query keys are shared, so multiple consumers dedupe.
 */

import { useMemo } from 'react';
import type { ObjectRichTextFormat } from '../keys/objectKeys';
import type { UnifiedObject } from '../../types/unifiedObject';
import { useObjectCollectionQuery } from './useObjectCollectionQuery';
import { useStoryEntityTreeQuery } from './useStoryEntityTreeQuery';

export function useProjectObjectsMap(
  projectId: string | undefined,
  language: string,
  format: ObjectRichTextFormat = 'markdown',
): Record<string, UnifiedObject> {
  const basicInfo = useObjectCollectionQuery(projectId, 'basic_info', language, format);
  const guidelines = useObjectCollectionQuery(projectId, 'guidelines', language, format);
  const outline = useObjectCollectionQuery(projectId, 'outline', language, format);
  const manuscript = useObjectCollectionQuery(projectId, 'manuscript', language, format);
  const tracks = useObjectCollectionQuery(projectId, 'timeline_track', language, format);
  const events = useObjectCollectionQuery(projectId, 'timeline_event', language, format);
  const tree = useStoryEntityTreeQuery(projectId, language, format);

  return useMemo(() => {
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
}

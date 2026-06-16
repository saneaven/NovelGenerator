/**
 * TanStack Query layer for the per-project timeline calendar config.
 *
 * Timeline tracks/events are unified objects (objectKeys.collection); only the
 * calendar config lives here. This replaces the former hand-rolled `configByProject`
 * cache + `isLoading`/`changeRevision`/`fetchTimelineRequestSeq` bookkeeping.
 */

import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../queryClient';
import { timelineKeys } from '../keys/timelineKeys';
import { objectKeys } from '../keys/objectKeys';
import { fetchObjectCollection } from '../objects/useObjectCollectionQuery';
import { timelineService, type TimelineConfig } from '../../api/timelineService';
import type { ObjectType } from '../../types/unifiedObject';

const TIMELINE_TYPES: ObjectType[] = ['timeline_track', 'timeline_event'];

export function timelineConfigQueryOptions(projectId: string) {
  return {
    queryKey: timelineKeys.config(projectId),
    queryFn: () => timelineService.getTimelineConfig(projectId),
    staleTime: 5 * 60_000,
  };
}

export function useTimelineConfig(projectId: string | undefined) {
  return useQuery({
    ...timelineConfigQueryOptions(projectId ?? '__none__'),
    enabled: Boolean(projectId),
  });
}

export function readTimelineConfigFromCache(projectId: string): TimelineConfig | undefined {
  return queryClient.getQueryData<TimelineConfig>(timelineKeys.config(projectId));
}

export function fetchTimelineConfig(projectId: string): Promise<TimelineConfig> {
  return queryClient.fetchQuery(timelineConfigQueryOptions(projectId));
}

export function setTimelineConfigInCache(projectId: string, config: TimelineConfig): void {
  queryClient.setQueryData(timelineKeys.config(projectId), config);
}

/**
 * Ensure the config + both timeline object collections (markdown) are in cache for
 * a language. Replaces the former `timelineStore.fetchTimeline` side effect; used by
 * callers that need timeline data loaded before reading it (e.g. translation modal).
 */
export async function ensureTimelineLoaded(projectId: string, language: string): Promise<void> {
  await Promise.all([
    fetchTimelineConfig(projectId),
    ...TIMELINE_TYPES.map((type) =>
      queryClient.ensureQueryData({
        queryKey: objectKeys.collection(projectId, type, language, 'markdown'),
        queryFn: () => fetchObjectCollection(projectId, type, language, 'markdown'),
      }),
    ),
  ]);
}

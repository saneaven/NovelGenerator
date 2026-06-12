import { useMemo } from 'react';
import type { CalendarConfig, TimelineTrack } from '../../../types/timeline';
import { computeTimelineLayout } from '../layout/computeTimelineLayout';
import { DESKTOP_SPACING, MOBILE_SPACING, type TimelineLayout } from '../layout/types';

interface UseTimelineLayoutArgs {
  tracks: TimelineTrack[];
  calendar: CalendarConfig;
  hiddenTrackIds: ReadonlySet<string>;
  tagFilter: ReadonlySet<string>;
  displayLanguage: string;
  isMobile: boolean;
}

export function useTimelineLayout({
  tracks,
  calendar,
  hiddenTrackIds,
  tagFilter,
  displayLanguage,
  isMobile,
}: UseTimelineLayoutArgs): TimelineLayout {
  return useMemo(
    () => computeTimelineLayout({
      tracks,
      calendar,
      hiddenTrackIds,
      tagFilter,
      displayLanguage,
      spacing: isMobile ? MOBILE_SPACING : DESKTOP_SPACING,
    }),
    [tracks, calendar, hiddenTrackIds, tagFilter, displayLanguage, isMobile],
  );
}

export default useTimelineLayout;

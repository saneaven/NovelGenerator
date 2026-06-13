import type { TimelineTrack } from '../../../types/timeline';
import {
  formatAnchorLabel,
  formatDate,
  fromBaseUnits,
  toBaseUnits,
  wholeTopUnitsBetween,
} from '../../../utils/timelineCalendar';
import { assignLanes, type SpanCandidate } from './lanes';
import { breakThreshold, gapForDelta, gapReferenceBase } from './spacing';
import type {
  AnchorRowData,
  BreakRowData,
  LayoutInput,
  LayoutRow,
  TimelineLayout,
  TrackPathEntry,
  VisibleEvent,
} from './types';

export function resolveEntityText(
  data: Record<string, unknown> | undefined,
  _displayLanguage: string,
  contentMarkdown?: string,
): { name: string; description: string; contentMarkdown: string } {
  return {
    name: typeof data?.name === 'string' ? data.name : '',
    description: typeof data?.description === 'string' ? data.description : '',
    contentMarkdown: contentMarkdown ?? '',
  };
}

const byTrackOrderAndName = (a: VisibleEvent, b: VisibleEvent) => (
  a.trackOrder - b.trackOrder || a.name.localeCompare(b.name)
);

export function computeTimelineLayout(input: LayoutInput): TimelineLayout {
  const { tracks, calendar, hiddenTrackIds, tagFilter, displayLanguage, resolveContentMarkdown, spacing } = input;

  // Step 1 — one DFS: visibility, track paths, colors, tags, event resolution
  const allVisible: VisibleEvent[] = [];
  const allTags = new Set<string>();
  let totalCount = 0;
  let dfsIndex = 0;

  const walk = (track: TimelineTrack, path: TrackPathEntry[], hidden: boolean) => {
    const { name } = resolveEntityText(track.data, displayLanguage);
    const nextPath = [...path, { id: track.id, name, color: track.color }];
    const isHidden = hidden || hiddenTrackIds.has(track.id);
    const trackOrder = dfsIndex;
    dfsIndex += 1;

    for (const event of track.events ?? []) {
      totalCount += 1;
      for (const tag of event.tags ?? []) allTags.add(tag);
      if (isHidden) continue;

      let startBase: number;
      let endBase: number | null = null;
      try {
        startBase = toBaseUnits(event.startDate, calendar);
        if (event.endDate) endBase = toBaseUnits(event.endDate, calendar);
      } catch {
        continue; // dates not valid for the active calendar — never crash the stream
      }
      if (endBase !== null && endBase < startBase) [startBase, endBase] = [endBase, startBase];
      if (endBase === startBase) endBase = null;

      const { name: eventName, description, contentMarkdown } = resolveEntityText(
        event.data,
        displayLanguage,
        resolveContentMarkdown?.(event),
      );
      allVisible.push({
        event,
        name: eventName,
        description,
        contentMarkdown,
        startBase,
        endBase,
        trackPath: nextPath,
        trackOrder,
        colorKey: track.color,
      });
    }
    for (const child of track.children ?? []) {
      walk(child, nextPath, isHidden);
    }
  };
  for (const track of tracks) walk(track, [], false);

  const visible = tagFilter.size === 0
    ? allVisible
    : allVisible.filter((ve) => (ve.event.tags ?? []).some((tag) => tagFilter.has(tag)));

  // Step 2 — anchors: sorted unique base positions of every start and end
  const anchorMap = new Map<number, { starts: VisibleEvent[]; ends: VisibleEvent[] }>();
  const anchorAt = (base: number) => {
    let anchor = anchorMap.get(base);
    if (!anchor) {
      anchor = { starts: [], ends: [] };
      anchorMap.set(base, anchor);
    }
    return anchor;
  };
  for (const ve of visible) {
    anchorAt(ve.startBase).starts.push(ve);
    if (ve.endBase !== null) anchorAt(ve.endBase).ends.push(ve);
  }
  const bases = [...anchorMap.keys()].sort((a, b) => a - b);

  // Steps 3–5 — gaps, breaks, labels
  const referenceBase = gapReferenceBase(calendar);
  const threshold = breakThreshold(calendar);
  const rows: LayoutRow[] = [];
  const breaks: Array<{ row: BreakRowData; prevBase: number; nextBase: number }> = [];
  let prevBase: number | null = null;
  let prevDate: ReturnType<typeof fromBaseUnits> | null = null;

  for (const base of bases) {
    const date = fromBaseUnits(base, calendar);
    let gapBefore = 0;
    if (prevBase !== null && prevDate !== null) {
      const breakCount = wholeTopUnitsBetween(prevDate, date, calendar);
      if (breakCount >= threshold) {
        const breakRow: BreakRowData = {
          kind: 'break',
          key: `b:${prevBase}:${base}`,
          gapBefore: spacing.breakGap,
          count: breakCount,
          unitName: calendar.mode === 'gregorian' ? 'year' : calendar.units[0].name,
          unitLabel: calendar.mode === 'gregorian' ? '' : (calendar.units[0].label || calendar.units[0].name),
          crossingEventIds: [],
          continuingEras: [],
        };
        rows.push(breakRow);
        breaks.push({ row: breakRow, prevBase, nextBase: base });
        gapBefore = spacing.breakGap;
      } else {
        gapBefore = gapForDelta(base - prevBase, referenceBase, spacing);
      }
    }

    const { starts, ends } = anchorMap.get(base)!;
    starts.sort(byTrackOrderAndName);
    const ghostEnds = ends.filter((ve) => ve.startBase !== base).sort(byTrackOrderAndName);
    const label = formatAnchorLabel(date, prevDate, calendar);
    const colorKeys = new Set(starts.map((ve) => ve.colorKey));
    const anchorRow: AnchorRowData = {
      kind: 'anchor',
      key: `a:${base}`,
      base,
      date,
      gapBefore,
      labelParts: label.parts,
      labelRank: label.rank,
      fullLabel: formatDate(date, calendar),
      starts,
      ends: ghostEnds,
      dominantColorKey: starts.length > 0 && colorKeys.size === 1 ? starts[0].colorKey : null,
    };
    rows.push(anchorRow);
    prevBase = base;
    prevDate = date;
  }

  // Step 6 — span lanes (era spans demoted first)
  const crossedBreaks = (startBase: number, endBase: number) =>
    breaks.filter(({ prevBase: p, nextBase: n }) => startBase <= p && n <= endBase);

  const candidates: SpanCandidate[] = visible
    .filter((ve) => ve.endBase !== null)
    .map((ve) => ({ ev: ve, breaksCrossed: crossedBreaks(ve.startBase, ve.endBase!).length }));
  const { placed, overflow, eras, laneCount } = assignLanes(candidates, spacing.maxLanes);

  for (const { ev } of placed) {
    for (const { row } of crossedBreaks(ev.startBase, ev.endBase!)) {
      row.crossingEventIds.push(ev.event.id);
    }
  }
  for (const ev of eras) {
    for (const { row } of crossedBreaks(ev.startBase, ev.endBase!)) {
      row.continuingEras.push({ eventId: ev.event.id, name: ev.name });
    }
  }

  // Step 7 — indices for deep links, rails, and overflow pills
  const rowIndexByEventId = new Map<string, number>();
  rows.forEach((row, index) => {
    if (row.kind !== 'anchor') return;
    for (const ve of row.starts) rowIndexByEventId.set(ve.event.id, index);
  });

  const eventById = new Map<string, VisibleEvent>();
  for (const ve of visible) eventById.set(ve.event.id, ve);

  const overflowAtAnchor = new Map<string, VisibleEvent[]>();
  for (const ev of overflow) {
    const key = `a:${ev.startBase}`;
    const list = overflowAtAnchor.get(key);
    if (list) list.push(ev);
    else overflowAtAnchor.set(key, [ev]);
  }

  return {
    rows,
    spans: placed.map(({ ev, lane }) => ({
      eventId: ev.event.id,
      lane,
      startRowKey: `a:${ev.startBase}`,
      endRowKey: `a:${ev.endBase}`,
      colorKey: ev.colorKey,
      name: ev.name,
    })),
    overflowSpanIds: new Set(overflow.map((ev) => ev.event.id)),
    overflowAtAnchor,
    eraSpanIds: new Set(eras.map((ev) => ev.event.id)),
    laneCount,
    rowIndexByEventId,
    eventById,
    allTags: [...allTags].sort((a, b) => a.localeCompare(b)),
    visibleCount: visible.length,
    totalCount,
  };
}

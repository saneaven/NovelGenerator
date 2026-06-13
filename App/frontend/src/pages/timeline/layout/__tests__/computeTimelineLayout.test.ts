import { describe, expect, it } from 'vitest';
import type { CalendarConfig, TimelineEvent, TimelineTrack, TimelineDate } from '../../../../types/timeline';
import { defaultCalendar } from '../../../../utils/timelineCalendar';
import { computeTimelineLayout } from '../computeTimelineLayout';
import {
  DESKTOP_SPACING,
  type AnchorRowData,
  type BreakRowData,
  type LayoutInput,
} from '../types';

const GREGORIAN = defaultCalendar();

const FLAT_CALENDAR: CalendarConfig = {
  mode: 'fixed',
  units: [{ name: 'day', label: 'Day' }],
};

let nextId = 0;
const id = (prefix: string) => `${prefix}-${(nextId += 1)}`;

function makeEvent(overrides: Partial<TimelineEvent> & { startDate: TimelineDate; name?: string }): TimelineEvent {
  const { name, ...rest } = overrides;
  return {
    id: id('ev'),
    trackId: 'unset',
    endDate: null,
    tags: [],
    createdAt: null,
    updatedAt: null,
    data: { name: name ?? 'Event', description: 'desc' },
    version: { id: null, number: 1, createdAt: null },
    links: [],
    ...rest,
  };
}

function makeTrack(overrides: Partial<TimelineTrack> & { name?: string }): TimelineTrack {
  const { name, ...rest } = overrides;
  const trackId = rest.id ?? id('tr');
  return {
    timelineId: 'tl',
    parentId: null,
    position: 0,
    color: 'oklch(0.680 0.140 250.0)',
    createdAt: null,
    updatedAt: null,
    data: { name: name ?? 'Track', description: '' },
    version: { id: null, number: 1, createdAt: null },
    events: (rest.events ?? []).map((ev) => ({ ...ev, trackId })),
    children: [],
    ...rest,
    id: trackId,
  };
}

function layout(partial: Partial<LayoutInput> & { tracks: TimelineTrack[] }) {
  return computeTimelineLayout({
    calendar: GREGORIAN,
    hiddenTrackIds: new Set(),
    tagFilter: new Set(),
    displayLanguage: 'en',
    spacing: DESKTOP_SPACING,
    ...partial,
  });
}

const date = (year: number, month = 1, day = 1, hour = 1, minute = 1): TimelineDate => ({ year, month, day, hour, minute });
const anchors = (rows: ReturnType<typeof layout>['rows']) => rows.filter((r): r is AnchorRowData => r.kind === 'anchor');
const breaks = (rows: ReturnType<typeof layout>['rows']) => rows.filter((r): r is BreakRowData => r.kind === 'break');

describe('visibility', () => {
  it('does not synthesize expanded content from tiptap projection data', () => {
    const event = makeEvent({
      startDate: date(1),
      data: {
        name: 'Founding Day',
        description: 'desc',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'The bells ring once at dawn.' }],
            },
          ],
        },
      },
    });
    const result = layout({ tracks: [makeTrack({ events: [event] })] });
    const [anchor] = anchors(result.rows);

    expect(anchor.starts[0].contentMarkdown).toBe('');
  });

  it('uses resolved markdown projection content for expanded cards', () => {
    const event = makeEvent({ startDate: date(1), data: { name: 'Founding Day', description: 'desc' } });
    const result = layout({
      tracks: [makeTrack({ events: [event] })],
      resolveContentMarkdown: (candidate) => (candidate.id === event.id ? '**Markdown** body' : undefined),
    });
    const [anchor] = anchors(result.rows);

    expect(anchor.starts[0].contentMarkdown).toBe('**Markdown** body');
  });

  it('hides events of hidden tracks and their descendants', () => {
    const leaf = makeTrack({ name: 'Leaf', events: [makeEvent({ startDate: date(1) })] });
    const parent = makeTrack({ name: 'Parent', children: [leaf] });
    const other = makeTrack({ name: 'Other', events: [makeEvent({ startDate: date(2) })] });

    const result = layout({ tracks: [parent, other], hiddenTrackIds: new Set([parent.id]) });
    expect(result.visibleCount).toBe(1);
    expect(result.totalCount).toBe(2);
    expect(anchors(result.rows)).toHaveLength(1);
  });

  it('filters by tags with OR semantics but reports all tags', () => {
    const track = makeTrack({
      events: [
        makeEvent({ startDate: date(1), tags: ['war'] }),
        makeEvent({ startDate: date(2), tags: ['politics'] }),
        makeEvent({ startDate: date(3), tags: ['magic'] }),
      ],
    });
    const result = layout({ tracks: [track], tagFilter: new Set(['war', 'magic']) });
    expect(result.visibleCount).toBe(2);
    expect(result.allTags).toEqual(['magic', 'politics', 'war']);
  });
});

describe('track colors', () => {
  it('uses the leaf track color as the event color key', () => {
    const leaf = makeTrack({
      name: 'Leaf',
      color: 'oklch(0.620 0.125 185.0)',
      events: [makeEvent({ startDate: date(1) })],
    });
    const root = makeTrack({ name: 'Root', color: 'oklch(0.680 0.140 250.0)', children: [leaf] });

    const result = layout({ tracks: [root] });
    const [anchor] = anchors(result.rows);
    expect(anchor.starts[0].colorKey).toBe('oklch(0.620 0.125 185.0)');
    expect(anchor.dominantColorKey).toBe('oklch(0.620 0.125 185.0)');
  });

  it('reports no dominant color for anchors mixing track colors', () => {
    const a = makeTrack({ name: 'A', color: 'oklch(0.680 0.140 250.0)', events: [makeEvent({ startDate: date(1) })] });
    const b = makeTrack({ name: 'B', color: 'oklch(0.680 0.140 70.0)', events: [makeEvent({ startDate: date(1) })] });

    const result = layout({ tracks: [a, b] });
    const [anchor] = anchors(result.rows);
    expect(anchor.dominantColorKey).toBeNull();
  });
});

describe('clusters', () => {
  it('groups events with identical base positions and sorts by track order', () => {
    const second = makeTrack({ name: 'B', events: [makeEvent({ startDate: date(5, 3, 12), name: 'From B' })] });
    const first = makeTrack({ name: 'A', events: [makeEvent({ startDate: date(5, 3, 12), name: 'From A' })] });

    const result = layout({ tracks: [first, second] });
    const rows = anchors(result.rows);
    expect(rows).toHaveLength(1);
    expect(rows[0].starts.map((ve) => ve.name)).toEqual(['From A', 'From B']);
  });
});

describe('gaps', () => {
  it('clamps to minGap for tiny deltas and grows monotonically', () => {
    const track = makeTrack({
      events: [
        makeEvent({ startDate: date(1, 1, 1, 1, 1) }),
        makeEvent({ startDate: date(1, 1, 1, 1, 2) }),   // +1 minute
        makeEvent({ startDate: date(1, 1, 2, 1, 2) }),   // +1 day
        makeEvent({ startDate: date(1, 4, 2, 1, 2) }),   // +3 months
      ],
    });
    const rows = anchors(layout({ tracks: [track] }).rows);
    expect(rows[0].gapBefore).toBe(0);
    const [, g1, g2, g3] = rows.map((r) => r.gapBefore);
    expect(g1).toBeGreaterThanOrEqual(DESKTOP_SPACING.minGap);
    expect(g1).toBeLessThan(g2);
    expect(g2).toBeLessThan(g3);
    expect(g3).toBeLessThanOrEqual(DESKTOP_SPACING.maxGap);
  });
});

describe('breaks', () => {
  it('does not break across a Dec→Jan boundary', () => {
    const track = makeTrack({
      events: [
        makeEvent({ startDate: date(1023, 12, 15) }),
        makeEvent({ startDate: date(1024, 1, 2) }),
      ],
    });
    const result = layout({ tracks: [track] });
    expect(breaks(result.rows)).toHaveLength(0);
  });

  it('inserts a break with the whole-year count', () => {
    const track = makeTrack({
      events: [
        makeEvent({ startDate: date(1024, 3, 5) }),
        makeEvent({ startDate: date(1027, 6, 1) }),
      ],
    });
    const result = layout({ tracks: [track] });
    const [breakRow] = breaks(result.rows);
    expect(breakRow.count).toBe(3);
    expect(breakRow.unitName).toBe('year');
    // the anchor after the break uses the break gap, not the proportional gap
    const after = anchors(result.rows)[1];
    expect(after.gapBefore).toBe(DESKTOP_SPACING.breakGap);
  });

  it('requires 10+ base units on single-unit calendars', () => {
    const near = makeTrack({ events: [makeEvent({ startDate: { day: 1 } }), makeEvent({ startDate: { day: 9 } })] });
    expect(breaks(layout({ tracks: [near], calendar: FLAT_CALENDAR }).rows)).toHaveLength(0);

    const far = makeTrack({ events: [makeEvent({ startDate: { day: 1 } }), makeEvent({ startDate: { day: 30 } })] });
    const [breakRow] = breaks(layout({ tracks: [far], calendar: FLAT_CALENDAR }).rows);
    expect(breakRow.count).toBe(29);
    expect(breakRow.unitLabel).toBe('Day');
  });
});

describe('duration spans', () => {
  it('mints end anchors and reports ghost ends', () => {
    const track = makeTrack({
      events: [makeEvent({ startDate: date(1, 1, 1), endDate: date(1, 3, 1), name: 'Siege' })],
    });
    const rows = anchors(layout({ tracks: [track] }).rows);
    expect(rows).toHaveLength(2);
    expect(rows[0].starts).toHaveLength(1);
    expect(rows[1].starts).toHaveLength(0);
    expect(rows[1].ends.map((ve) => ve.name)).toEqual(['Siege']);
  });

  it('swaps inverted ranges and treats zero-length as instant', () => {
    const track = makeTrack({
      events: [
        makeEvent({ startDate: date(2, 1, 1), endDate: date(1, 1, 1), name: 'Inverted' }),
        makeEvent({ startDate: date(5, 1, 1), endDate: date(5, 1, 1), name: 'Zero' }),
      ],
    });
    const result = layout({ tracks: [track] });
    const span = result.spans.find((s) => s.name === 'Inverted');
    expect(span).toBeDefined();
    expect(span!.startRowKey < span!.endRowKey || result.rows.findIndex((r) => r.key === span!.startRowKey) < result.rows.findIndex((r) => r.key === span!.endRowKey)).toBe(true);
    expect(result.spans.find((s) => s.name === 'Zero')).toBeUndefined();
    expect(result.eventById.get(track.events[1].id)?.endBase).toBeNull();
  });

  it('assigns deterministic lanes and overflows past the budget', () => {
    const overlapping = [0, 1, 2, 3].map((i) => makeEvent({
      startDate: date(1, 1 + i, 1),
      endDate: date(2, 6, 1),
      name: `Span ${i}`,
    }));
    const track = makeTrack({ events: overlapping });
    const a = layout({ tracks: [track] });
    const b = layout({ tracks: [track] });
    expect(a.spans.map((s) => [s.eventId, s.lane])).toEqual(b.spans.map((s) => [s.eventId, s.lane]));
    expect(a.spans).toHaveLength(3);
    expect(a.laneCount).toBe(3);
    expect(a.overflowSpanIds.size).toBe(1);
    const overflowed = [...a.overflowSpanIds][0];
    const startKey = `a:${a.eventById.get(overflowed)!.startBase}`;
    expect(a.overflowAtAnchor.get(startKey)?.map((ve) => ve.event.id)).toEqual([overflowed]);
  });

  it('reuses a lane when spans merely touch', () => {
    const track = makeTrack({
      events: [
        makeEvent({ startDate: date(1, 1, 1), endDate: date(1, 6, 1) }),
        makeEvent({ startDate: date(1, 6, 1), endDate: date(1, 9, 1) }),
      ],
    });
    const result = layout({ tracks: [track] });
    expect(result.laneCount).toBe(1);
    expect(result.spans.map((s) => s.lane)).toEqual([0, 0]);
  });

  it('demotes era spans crossing 3+ breaks and annotates the breaks', () => {
    const track = makeTrack({
      events: [
        makeEvent({ startDate: date(1000), endDate: date(1100), name: 'Long Era' }),
        // anchors that create 3 breaks inside the era
        makeEvent({ startDate: date(1010) }),
        makeEvent({ startDate: date(1030) }),
        makeEvent({ startDate: date(1050) }),
      ],
    });
    const result = layout({ tracks: [track] });
    expect(result.eraSpanIds.size).toBe(1);
    expect(result.spans.find((s) => s.name === 'Long Era')).toBeUndefined();
    const allBreaks = breaks(result.rows);
    expect(allBreaks.length).toBeGreaterThanOrEqual(3);
    for (const breakRow of allBreaks) {
      expect(breakRow.continuingEras.map((e) => e.name)).toContain('Long Era');
    }
  });

  it('marks laned spans crossing a break for dashed rendering', () => {
    const track = makeTrack({
      events: [
        makeEvent({ startDate: date(1000, 1, 1), endDate: date(1002, 6, 1), name: 'Crossing' }),
        makeEvent({ startDate: date(1002, 1, 1), name: 'Far point' }),
      ],
    });
    const result = layout({ tracks: [track] });
    const [breakRow] = breaks(result.rows);
    const crossing = result.spans.find((s) => s.name === 'Crossing')!;
    expect(breakRow.crossingEventIds).toContain(crossing.eventId);
  });
});

describe('robustness', () => {
  it('skips events whose dates are invalid for the active calendar', () => {
    const track = makeTrack({
      events: [
        makeEvent({ startDate: { year: 1, month: 99, day: 1 } }),
        makeEvent({ startDate: date(1) }),
      ],
    });
    const result = layout({ tracks: [track] });
    expect(result.visibleCount).toBe(1);
  });

  it('handles an empty timeline', () => {
    const result = layout({ tracks: [] });
    expect(result.rows).toEqual([]);
    expect(result.laneCount).toBe(0);
    expect(result.visibleCount).toBe(0);
  });

  it('indexes start rows for deep links', () => {
    const ev = makeEvent({ startDate: date(7) });
    const track = makeTrack({ events: [ev, makeEvent({ startDate: date(3) })] });
    const result = layout({ tracks: [track] });
    const rowIndex = result.rowIndexByEventId.get(ev.id)!;
    const row = result.rows[rowIndex];
    expect(row.kind).toBe('anchor');
    expect((row as AnchorRowData).starts.some((ve) => ve.event.id === ev.id)).toBe(true);
  });
});

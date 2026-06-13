import type { CalendarConfig, TimelineDate, TimelineEvent, TimelineTrack } from '../../../types/timeline';
import type { AnchorLabelPart } from '../../../utils/timelineCalendar';

export interface TrackPathEntry {
  id: string;
  name: string;
  color: string;
}

/** A timeline event resolved for layout: base positions, track context, display strings. */
export interface VisibleEvent {
  event: TimelineEvent;
  name: string;
  description: string;
  /** language-resolved rich-text body, server-rendered to markdown ('' when empty) */
  contentMarkdown: string;
  startBase: number;
  /** null = instant event; otherwise normalized so endBase > startBase */
  endBase: number | null;
  /** root → leaf */
  trackPath: TrackPathEntry[];
  /** DFS index of the leaf track — stable in-cluster ordering */
  trackOrder: number;
  /** the leaf track's stored color */
  colorKey: string;
}

export interface SpacingConfig {
  minGap: number;
  maxGap: number;
  /** gap above a break row and above the anchor that follows it */
  breakGap: number;
  maxLanes: number;
  clusterCollapseAt: number;
}

export const DESKTOP_SPACING: SpacingConfig = { minGap: 48, maxGap: 160, breakGap: 24, maxLanes: 3, clusterCollapseAt: 4 };
export const MOBILE_SPACING: SpacingConfig = { minGap: 40, maxGap: 112, breakGap: 16, maxLanes: 2, clusterCollapseAt: 3 };

/** Single-unit calendars have no super-unit; only gaps of at least this many base units break. */
export const FLAT_CALENDAR_BREAK_MIN = 10;
/** Spans crossing at least this many breaks are demoted from the rail lanes. */
export const ERA_SPAN_BREAKS = 3;

export interface LayoutInput {
  tracks: TimelineTrack[];
  calendar: CalendarConfig;
  hiddenTrackIds: ReadonlySet<string>;
  /** OR semantics; empty set = no filtering */
  tagFilter: ReadonlySet<string>;
  displayLanguage: string;
  resolveContentMarkdown?: (event: TimelineEvent) => string | undefined;
  spacing: SpacingConfig;
}

export interface AnchorRowData {
  kind: 'anchor';
  /** stable across refetches as long as the date set is unchanged */
  key: string;
  base: number;
  date: TimelineDate;
  /** px margin above this row; a minimum — content may stretch it */
  gapBefore: number;
  /** changed units, highest first — one line each in the gutter */
  labelParts: AnchorLabelPart[];
  /** rank of the highest changed unit (0 = top unit) — drives row/node hierarchy */
  labelRank: number;
  /** full formatDate() output for tooltips */
  fullLabel: string;
  /** the cluster starting here, sorted (trackOrder, name) */
  starts: VisibleEvent[];
  /** spans terminating here (ghost end caps), sorted (trackOrder, name) */
  ends: VisibleEvent[];
  /** set iff every start shares one color; null = mixed (brand default) */
  dominantColorKey: string | null;
}

export interface BreakRowData {
  kind: 'break';
  key: string;
  gapBefore: number;
  /** N whole top units elapsed */
  count: number;
  /** 'year' for gregorian; units[0].name for fixed calendars */
  unitName: string;
  /** user-authored top-unit label for fixed calendars; '' for gregorian */
  unitLabel: string;
  /** laned spans passing through → dashed rail segment */
  crossingEventIds: string[];
  /** demoted era spans passing through → “X continues” annotations */
  continuingEras: Array<{ eventId: string; name: string }>;
}

export type LayoutRow = AnchorRowData | BreakRowData;

export interface SpanPlacement {
  eventId: string;
  lane: number;
  startRowKey: string;
  endRowKey: string;
  colorKey: string;
  name: string;
}

export interface TimelineLayout {
  rows: LayoutRow[];
  /** laned spans only */
  spans: SpanPlacement[];
  /** spans denied a lane by the lane budget → range chip + gutter pill */
  overflowSpanIds: Set<string>;
  /** overflowed spans grouped by their start anchor key (for the +N gutter pill) */
  overflowAtAnchor: Map<string, VisibleEvent[]>;
  /** ultra-long spans demoted from lanes → range chip + break annotations */
  eraSpanIds: Set<string>;
  /** lanes actually used → rail gutter width */
  laneCount: number;
  /** event id → row index of its start anchor (deep links) */
  rowIndexByEventId: Map<string, number>;
  eventById: Map<string, VisibleEvent>;
  /** distinct tags across ALL events, pre-filter (drives the filter UI) */
  allTags: string[];
  visibleCount: number;
  totalCount: number;
}

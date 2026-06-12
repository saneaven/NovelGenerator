import { ERA_SPAN_BREAKS, type VisibleEvent } from './types';

export interface SpanCandidate {
  ev: VisibleEvent;
  breaksCrossed: number;
}

export interface LaneAssignment {
  placed: Array<{ ev: VisibleEvent; lane: number }>;
  overflow: VisibleEvent[];
  eras: VisibleEvent[];
  laneCount: number;
}

/**
 * Greedy interval coloring over duration spans. Sort order (startBase asc,
 * duration desc, eventId asc) makes lane assignment deterministic across
 * refetches — lanes only change when the interval set itself changes.
 * Spans crossing >= ERA_SPAN_BREAKS break separators are demoted (no lane)
 * so an era-scale background span cannot pin a lane for the whole scroll.
 */
export function assignLanes(candidates: SpanCandidate[], maxLanes: number): LaneAssignment {
  const placed: LaneAssignment['placed'] = [];
  const overflow: VisibleEvent[] = [];
  const eras: VisibleEvent[] = [];

  const sorted = [...candidates].sort((a, b) => (
    a.ev.startBase - b.ev.startBase
    || (b.ev.endBase! - b.ev.startBase) - (a.ev.endBase! - a.ev.startBase)
    || (a.ev.event.id < b.ev.event.id ? -1 : a.ev.event.id > b.ev.event.id ? 1 : 0)
  ));

  const laneEnds: number[] = [];
  for (const candidate of sorted) {
    const { ev } = candidate;
    if (candidate.breaksCrossed >= ERA_SPAN_BREAKS) {
      eras.push(ev);
      continue;
    }
    const lane = laneEnds.findIndex((end) => end <= ev.startBase);
    if (lane !== -1) {
      laneEnds[lane] = ev.endBase!;
      placed.push({ ev, lane });
    } else if (laneEnds.length < maxLanes) {
      laneEnds.push(ev.endBase!);
      placed.push({ ev, lane: laneEnds.length - 1 });
    } else {
      overflow.push(ev);
    }
  }

  return { placed, overflow, eras, laneCount: laneEnds.length };
}

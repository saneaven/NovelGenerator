import type { TFunction } from 'i18next';
import type { CalendarConfig, TimelineDate } from '../../../types/timeline';
import { durationBreakdown, isGregorianCalendar, unitLabelTokens } from '../../../utils/timelineCalendar';
import type { VisibleEvent } from '../layout/types';

const GREGORIAN_DURATION_UNITS = new Set(['year', 'month', 'day', 'hour', 'minute']);

/** "3년 5개월" / "3 years 5 months" from a base-unit delta. */
export function formatDuration(deltaBase: number, calendar: CalendarConfig, t: TFunction): string {
  return durationBreakdown(deltaBase, calendar)
    .map((part) => (
      isGregorianCalendar(calendar) && GREGORIAN_DURATION_UNITS.has(part.unitName)
        ? t(`timeline.duration.${part.unitName}`, { count: part.value })
        : t('timeline.duration.unit', { count: part.value, unit: part.unitLabel })
    ))
    .join(' ');
}

export function spanDuration(ve: VisibleEvent, calendar: CalendarConfig, t: TFunction): string | null {
  if (ve.endBase === null) return null;
  return formatDuration(ve.endBase - ve.startBase, calendar, t);
}

/** Localized break separator text. */
export function formatBreakText(
  count: number,
  unitLabel: string,
  calendar: CalendarConfig,
  t: TFunction,
): string {
  if (isGregorianCalendar(calendar)) return t('timeline.break.yearsLater', { count });
  return t('timeline.break.unitsLater', { count, unit: unitLabel });
}

/**
 * Sticky pill text: the higher-order units the top viewport card omitted (ranks above its
 * label rank), so pill + card reads as the full date. The top unit is always kept, so the
 * pill never empties even on a top-unit-boundary card.
 */
export function stickyPeriodLabel(date: TimelineDate, labelRank: number, calendar: CalendarConfig): string {
  return unitLabelTokens(date, calendar).slice(0, Math.max(labelRank, 1)).join(' ');
}

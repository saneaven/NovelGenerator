import type { CalendarConfig, CalendarUnit, TimelineDate } from '../types/timeline';

export const DEFAULT_CALENDAR: CalendarConfig = {
  mode: 'gregorian',
  units: [
    { name: 'year', label: 'Year', count: 12 },
    { name: 'month', label: 'Month', count: 31 },
    { name: 'day', label: 'Day', count: 24 },
    { name: 'hour', label: 'Hour', count: 60 },
    { name: 'minute', label: 'Minute' },
  ],
};

export function defaultCalendar(): CalendarConfig {
  return {
    mode: DEFAULT_CALENDAR.mode,
    units: DEFAULT_CALENDAR.units.map((unit) => ({ ...unit })),
  };
}

export function calendarMode(value: CalendarConfig | CalendarUnit[]): 'fixed' | 'gregorian' {
  return !Array.isArray(value) && value.mode === 'gregorian' ? 'gregorian' : 'fixed';
}

export function isGregorianCalendar(value: CalendarConfig | CalendarUnit[]): boolean {
  return calendarMode(value) === 'gregorian';
}

function coerceUnits(value: CalendarConfig | CalendarUnit[]): CalendarUnit[] {
  const units = Array.isArray(value) ? value : value.units;
  if (!Array.isArray(units) || units.length === 0) {
    throw new Error('calendar.units must be a non-empty array');
  }
  return units.map((unit, index) => {
    if (!unit?.name) {
      throw new Error(`calendar.units[${index}].name is required`);
    }
    if (index < units.length - 1 && (!Number.isInteger(unit.count) || Number(unit.count) <= 0)) {
      throw new Error(`calendar.units[${index}].count is required for non-terminal units`);
    }
    return { ...unit };
  });
}

function unitMultiplier(units: CalendarUnit[], index: number): number {
  let multiplier = 1;
  for (let cursor = index; cursor < units.length; cursor += 1) {
    const count = units[cursor].count;
    if (!Number.isInteger(count)) break;
    multiplier *= Number(count);
  }
  return multiplier;
}

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if ([4, 6, 9, 11].includes(month)) return 30;
  return 31;
}

function daysBeforeYear(year: number): number {
  const previous = year - 1;
  return (previous * 365) + Math.floor(previous / 4) - Math.floor(previous / 100) + Math.floor(previous / 400);
}

function daysBeforeMonth(year: number, month: number): number {
  let total = 0;
  for (let cursor = 1; cursor < month; cursor += 1) {
    total += daysInMonth(year, cursor);
  }
  return total;
}

function gregorianPart(
  dateValue: Record<string, unknown>,
  name: string,
  options: { required: boolean; defaultValue?: number },
): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(dateValue, name)) {
    return options.required ? undefined : options.defaultValue ?? 1;
  }
  const raw = dateValue[name];
  return Number.isInteger(raw) ? Number(raw) : undefined;
}

function validateGregorianDate(dateValue: unknown): dateValue is TimelineDate {
  if (!dateValue || typeof dateValue !== 'object' || Array.isArray(dateValue)) return false;
  const raw = dateValue as Record<string, unknown>;
  const year = gregorianPart(raw, 'year', { required: true });
  const month = gregorianPart(raw, 'month', { required: true });
  const day = gregorianPart(raw, 'day', { required: true });
  const hour = gregorianPart(raw, 'hour', { required: false, defaultValue: 1 });
  const minute = gregorianPart(raw, 'minute', { required: false, defaultValue: 1 });
  if ([year, month, day, hour, minute].some((value) => value === undefined)) return false;
  if (year! < 1 || month! < 1 || month! > 12 || day! < 1) return false;
  if (day! > daysInMonth(year!, month!)) return false;
  if (hour! < 1 || hour! > 24 || minute! < 1 || minute! > 60) return false;
  return true;
}

function gregorianToBaseUnits(dateValue: TimelineDate): number {
  if (!validateGregorianDate(dateValue)) {
    throw new Error('Invalid timeline date');
  }
  const year = Number(dateValue.year);
  const month = Number(dateValue.month);
  const day = Number(dateValue.day);
  const hour = Number(dateValue.hour ?? 1);
  const minute = Number(dateValue.minute ?? 1);
  const days = daysBeforeYear(year) + daysBeforeMonth(year, month) + day - 1;
  return (days * 24 * 60) + ((hour - 1) * 60) + (minute - 1);
}

function yearFromDayPosition(dayPosition: number): number {
  let low = 1;
  let high = Math.max(2, Math.floor(dayPosition / 365) + 2);
  while (daysBeforeYear(high + 1) <= dayPosition) {
    high *= 2;
  }
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (daysBeforeYear(mid) <= dayPosition) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

function gregorianFromBaseUnits(position: number): TimelineDate {
  const remaining = Math.max(Math.trunc(position || 0), 0);
  const dayPosition = Math.floor(remaining / (24 * 60));
  const minuteOfDay = remaining % (24 * 60);
  const year = yearFromDayPosition(dayPosition);
  let dayOfYear = dayPosition - daysBeforeYear(year);
  let month = 1;
  while (dayOfYear >= daysInMonth(year, month)) {
    dayOfYear -= daysInMonth(year, month);
    month += 1;
  }
  const hourOffset = Math.floor(minuteOfDay / 60);
  const minuteOffset = minuteOfDay % 60;
  return {
    year,
    month,
    day: dayOfYear + 1,
    hour: hourOffset + 1,
    minute: minuteOffset + 1,
  };
}

export function dateUnitMax(calendar: CalendarConfig, dateValue: TimelineDate, unitName: string): number | undefined {
  if (isGregorianCalendar(calendar)) {
    if (unitName === 'month') return 12;
    if (unitName === 'day') return daysInMonth(Number(dateValue.year ?? 1), Number(dateValue.month ?? 1));
    if (unitName === 'hour') return 24;
    if (unitName === 'minute') return 60;
    return undefined;
  }
  return calendar.units.find((unit) => unit.name === unitName)?.count;
}

export function clampTimelineDate(dateValue: TimelineDate, calendar: CalendarConfig): TimelineDate {
  if (!isGregorianCalendar(calendar)) return dateValue;
  const year = Math.max(1, Math.trunc(Number(dateValue.year ?? 1)));
  const month = Math.min(12, Math.max(1, Math.trunc(Number(dateValue.month ?? 1))));
  const day = Math.min(
    daysInMonth(year, month),
    Math.max(1, Math.trunc(Number(dateValue.day ?? 1))),
  );
  const hour = Math.min(24, Math.max(1, Math.trunc(Number(dateValue.hour ?? 1))));
  const minute = Math.min(60, Math.max(1, Math.trunc(Number(dateValue.minute ?? 1))));
  return { ...dateValue, year, month, day, hour, minute };
}

export function validateDate(dateValue: unknown, unitsOrCalendar: CalendarConfig | CalendarUnit[]): dateValue is TimelineDate {
  if (isGregorianCalendar(unitsOrCalendar)) return validateGregorianDate(dateValue);
  if (!dateValue || typeof dateValue !== 'object') return false;
  const units = coerceUnits(unitsOrCalendar);
  return units.every((unit, i) => {
    const raw = Object.prototype.hasOwnProperty.call(dateValue, unit.name)
      ? (dateValue as Record<string, unknown>)[unit.name]
      : 1;
    if (!Number.isInteger(raw) || Number(raw) < 1) return false;
    if (i > 0) {
      const parentCount = units[i - 1].count;
      if (Number.isInteger(parentCount) && Number(raw) > Number(parentCount)) return false;
    }
    return true;
  });
}

export function toBaseUnits(dateValue: TimelineDate, unitsOrCalendar: CalendarConfig | CalendarUnit[]): number {
  if (isGregorianCalendar(unitsOrCalendar)) return gregorianToBaseUnits(dateValue);
  const units = coerceUnits(unitsOrCalendar);
  if (!validateDate(dateValue, units)) {
    throw new Error('Invalid timeline date');
  }
  return units.reduce(
    (sum, unit, index) => sum + ((Number(dateValue[unit.name] ?? 1) - 1) * unitMultiplier(units, index)),
    0,
  );
}

export function fromBaseUnits(position: number, unitsOrCalendar: CalendarConfig | CalendarUnit[]): TimelineDate {
  if (isGregorianCalendar(unitsOrCalendar)) return gregorianFromBaseUnits(position);
  const units = coerceUnits(unitsOrCalendar);
  let remaining = Math.max(Math.trunc(position || 0), 0);
  const result: TimelineDate = {};
  units.forEach((unit, index) => {
    const multiplier = unitMultiplier(units, index);
    if (!Number.isInteger(unit.count)) {
      result[unit.name] = remaining + 1;
      remaining = 0;
      return;
    }
    result[unit.name] = Math.floor(remaining / multiplier) + 1;
    remaining %= multiplier;
  });
  return result;
}

export function formatDate(dateValue: TimelineDate, unitsOrCalendar: CalendarConfig | CalendarUnit[]): string {
  const units = coerceUnits(unitsOrCalendar);
  return units.map((unit) => `${unit.label} ${Number(dateValue[unit.name] ?? 1)}`).join(' / ');
}

export function compareTimelineDates(
  a: TimelineDate,
  b: TimelineDate,
  unitsOrCalendar: CalendarConfig | CalendarUnit[],
): number {
  return toBaseUnits(a, unitsOrCalendar) - toBaseUnits(b, unitsOrCalendar);
}

/** Base units in one top calendar unit. Gregorian uses the mean year (spacing math only — never for break counting). */
export function baseUnitsPerTopUnit(unitsOrCalendar: CalendarConfig | CalendarUnit[]): number {
  if (isGregorianCalendar(unitsOrCalendar)) return 365.2425 * 24 * 60;
  const units = coerceUnits(unitsOrCalendar);
  if (units.length === 1) return 1;
  return unitMultiplier(units, 0);
}

function lexLess(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

/**
 * Whole top calendar units elapsed between a and b (a <= b expected; never negative).
 * Gregorian counts whole years by date-component comparison (leap-exact; a Dec→Jan
 * boundary is 0 years), with the anniversary day clamped for Feb-29 starts.
 */
export function wholeTopUnitsBetween(
  a: TimelineDate,
  b: TimelineDate,
  unitsOrCalendar: CalendarConfig | CalendarUnit[],
): number {
  if (!isGregorianCalendar(unitsOrCalendar)) {
    const units = coerceUnits(unitsOrCalendar);
    const delta = toBaseUnits(b, units) - toBaseUnits(a, units);
    if (units.length === 1) return Math.max(delta, 0);
    return Math.max(Math.floor(delta / unitMultiplier(units, 0)), 0);
  }
  let n = Number(b.year) - Number(a.year);
  const aDay = Math.min(Number(a.day ?? 1), daysInMonth(Number(b.year), Number(a.month ?? 1)));
  const aKey = [Number(a.month ?? 1), aDay, Number(a.hour ?? 1), Number(a.minute ?? 1)];
  const bKey = [Number(b.month ?? 1), Number(b.day ?? 1), Number(b.hour ?? 1), Number(b.minute ?? 1)];
  if (lexLess(bKey, aKey)) n -= 1;
  return Math.max(n, 0);
}

export interface AnchorLabelPart {
  text: string;
  /** absolute unit index (0 = top unit) — drives the per-line type scale */
  rank: number;
}

export interface AnchorLabel {
  /** changed units, highest first — one line each in the gutter */
  parts: AnchorLabelPart[];
  /** rank of the highest changed unit — drives row/node hierarchy */
  rank: number;
}

interface LabelGroup {
  text: string;
  differs: boolean;
  isDefault: boolean;
}

const pad2 = (value: number) => String(value).padStart(2, '0');

function buildLabelGroups(
  dateValue: TimelineDate,
  prevDate: TimelineDate | null,
  unitsOrCalendar: CalendarConfig | CalendarUnit[],
): LabelGroup[] {
  const part = (d: TimelineDate, name: string) => Number(d[name] ?? 1);
  if (isGregorianCalendar(unitsOrCalendar)) {
    const diff = (name: string) => prevDate !== null && part(dateValue, name) !== part(prevDate, name);
    return [
      { text: `Y${part(dateValue, 'year')}`, differs: diff('year'), isDefault: part(dateValue, 'year') === 1 },
      { text: `M${part(dateValue, 'month')}`, differs: diff('month'), isDefault: part(dateValue, 'month') === 1 },
      { text: `D${part(dateValue, 'day')}`, differs: diff('day'), isDefault: part(dateValue, 'day') === 1 },
      {
        // hour+minute form one atomic clock token (1-based units → 0-based clock)
        text: `${pad2(part(dateValue, 'hour') - 1)}:${pad2(part(dateValue, 'minute') - 1)}`,
        differs: diff('hour') || diff('minute'),
        isDefault: part(dateValue, 'hour') === 1 && part(dateValue, 'minute') === 1,
      },
    ];
  }
  const units = coerceUnits(unitsOrCalendar);
  return units.map((unit) => ({
    text: `${unit.label || unit.name} ${part(dateValue, unit.name)}`,
    differs: prevDate !== null && part(dateValue, unit.name) !== part(prevDate, unit.name),
    isDefault: part(dateValue, unit.name) === 1,
  }));
}

/**
 * Anchor gutter label: one part per unit from the highest changed unit (top unit for
 * the first anchor) down to the lowest changed unit, so near-coincident anchors stay
 * distinguishable. With no previous anchor, trailing all-default (value 1) units are
 * trimmed instead.
 */
export function formatAnchorLabel(
  dateValue: TimelineDate,
  prevDate: TimelineDate | null,
  unitsOrCalendar: CalendarConfig | CalendarUnit[],
): AnchorLabel {
  const groups = buildLabelGroups(dateValue, prevDate, unitsOrCalendar);
  let start: number;
  let end: number;
  if (prevDate === null) {
    start = 0;
    end = groups.length - 1;
    while (end > start && groups[end].isDefault) end -= 1;
  } else {
    start = groups.findIndex((group) => group.differs);
    if (start === -1) {
      // identical dates should not occur between distinct anchors; show the terminal group
      start = groups.length - 1;
      end = start;
    } else {
      end = groups.length - 1;
      while (end > start && !groups[end].differs) end -= 1;
    }
  }
  return {
    parts: groups.slice(start, end + 1).map((group, i) => ({ text: group.text, rank: start + i })),
    rank: start,
  };
}

export interface DurationPart {
  unitName: string;
  unitLabel: string;
  value: number;
}

/**
 * Humanized breakdown of a base-unit delta: the top two nonzero units, largest first.
 * Gregorian uses fixed 365-day years / 30-day months — display approximation only.
 */
export function durationBreakdown(
  deltaBase: number,
  unitsOrCalendar: CalendarConfig | CalendarUnit[],
): DurationPart[] {
  if (!Number.isFinite(deltaBase) || deltaBase <= 0) return [];
  let scale: Array<{ unitName: string; unitLabel: string; multiplier: number }>;
  if (isGregorianCalendar(unitsOrCalendar)) {
    scale = [
      { unitName: 'year', unitLabel: 'Year', multiplier: 365 * 24 * 60 },
      { unitName: 'month', unitLabel: 'Month', multiplier: 30 * 24 * 60 },
      { unitName: 'day', unitLabel: 'Day', multiplier: 24 * 60 },
      { unitName: 'hour', unitLabel: 'Hour', multiplier: 60 },
      { unitName: 'minute', unitLabel: 'Minute', multiplier: 1 },
    ];
  } else {
    const units = coerceUnits(unitsOrCalendar);
    scale = units.map((unit, index) => ({
      unitName: unit.name,
      unitLabel: unit.label || unit.name,
      multiplier: unitMultiplier(units, index),
    }));
  }
  const parts: DurationPart[] = [];
  let remaining = Math.trunc(deltaBase);
  for (const { unitName, unitLabel, multiplier } of scale) {
    const value = Math.floor(remaining / multiplier);
    remaining -= value * multiplier;
    if (value > 0) parts.push({ unitName, unitLabel, value });
    if (parts.length === 2) break;
  }
  return parts;
}

export function migrateDates(
  oldUnitsOrCalendar: CalendarConfig | CalendarUnit[],
  newUnitsOrCalendar: CalendarConfig | CalendarUnit[],
  dates: Array<TimelineDate | null | undefined>,
): { dates: Array<TimelineDate | null>; warnings: string[] } {
  if (calendarMode(oldUnitsOrCalendar) !== calendarMode(newUnitsOrCalendar)) {
    return {
      dates: dates.map((dateValue) => (
        dateValue ? fromBaseUnits(toBaseUnits(dateValue, oldUnitsOrCalendar), newUnitsOrCalendar) : null
      )),
      warnings: [],
    };
  }

  const oldUnits = coerceUnits(oldUnitsOrCalendar);
  const newUnits = coerceUnits(newUnitsOrCalendar);

  const renamedPairs = oldUnits
    .slice(0, Math.min(oldUnits.length, newUnits.length))
    .map((unit, index) => [unit.name, newUnits[index].name] as const)
    .filter(([oldName, newName]) => oldName !== newName);

  const removedUnits = oldUnits.slice(newUnits.length).map((unit) => unit.name);
  const addedUnits = newUnits.slice(oldUnits.length).map((unit) => unit.name);
  const warnings = new Set<string>();

  const migrated = dates.map((dateValue) => {
    if (!dateValue) return null;
    const nextValue: TimelineDate = {};
    oldUnits.forEach((unit) => {
      nextValue[unit.name] = Number(dateValue[unit.name] ?? 1);
    });
    renamedPairs.forEach(([oldName, newName]) => {
      nextValue[newName] = Number(nextValue[oldName] ?? 1);
      delete nextValue[oldName];
    });
    removedUnits.forEach((unitName) => {
      if (Number(nextValue[unitName] ?? 1) !== 1) {
        warnings.add(`Removed calendar unit '${unitName}' discarded non-default values`);
      }
      delete nextValue[unitName];
    });
    addedUnits.forEach((unitName) => {
      if (!(unitName in nextValue)) {
        nextValue[unitName] = 1;
      }
    });
    const ordered = newUnits.reduce<TimelineDate>((acc, unit) => {
      acc[unit.name] = Number(nextValue[unit.name] ?? 1);
      return acc;
    }, {});

    // Carry propagation: redistribute values that exceed the parent's count
    for (let i = newUnits.length - 1; i > 0; i--) {
      const parentCount = newUnits[i - 1].count;
      if (!Number.isInteger(parentCount)) continue;
      const unitName = newUnits[i].name;
      const value = Number(ordered[unitName] ?? 1);
      if (value > Number(parentCount)) {
        const carry = Math.floor((value - 1) / Number(parentCount));
        ordered[unitName] = ((value - 1) % Number(parentCount)) + 1;
        const parentName = newUnits[i - 1].name;
        ordered[parentName] = Number(ordered[parentName] ?? 1) + carry;
      }
    }

    return ordered;
  });

  return {
    dates: migrated,
    warnings: [...warnings],
  };
}

import type { CalendarConfig, CalendarUnit, TimelineDate } from '../types/timeline';

export const DEFAULT_CALENDAR: CalendarConfig = {
  units: [
    { name: 'year', label: 'Year', count: 12 },
    { name: 'month', label: 'Month', count: 30 },
    { name: 'day', label: 'Day', count: 24 },
    { name: 'hour', label: 'Hour', count: 60 },
    { name: 'minute', label: 'Minute' },
  ],
};

export function defaultCalendar(): CalendarConfig {
  return {
    units: DEFAULT_CALENDAR.units.map((unit) => ({ ...unit })),
  };
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

export function validateDate(dateValue: unknown, unitsOrCalendar: CalendarConfig | CalendarUnit[]): dateValue is TimelineDate {
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

export function migrateDates(
  oldUnitsOrCalendar: CalendarConfig | CalendarUnit[],
  newUnitsOrCalendar: CalendarConfig | CalendarUnit[],
  dates: Array<TimelineDate | null | undefined>,
): { dates: Array<TimelineDate | null>; warnings: string[] } {
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

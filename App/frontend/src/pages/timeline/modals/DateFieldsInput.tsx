import React from 'react';
import { NumberInput } from '../../../components/ui/NumberInput';
import type { CalendarConfig, TimelineDate } from '../../../types/timeline';
import { clampTimelineDate, dateUnitMax } from '../../../utils/timelineCalendar';

interface DateFieldsInputProps {
  calendar: CalendarConfig;
  value: TimelineDate;
  onChange: (next: TimelineDate) => void;
  idPrefix: string;
  invalid?: boolean;
}

/** One numeric input per calendar unit — adapts to any CalendarConfig. */
const DateFieldsInput: React.FC<DateFieldsInputProps> = ({ calendar, value, onChange, idPrefix, invalid = false }) => (
  <div className={`tl-form__date-row ${invalid ? 'tl-form__date-row--invalid' : ''}`}>
    {calendar.units.map((unit) => (
      <label className="tl-form__date-unit" key={unit.name} htmlFor={`${idPrefix}-${unit.name}`}>
        <span className="tl-form__date-unit-label">{unit.label || unit.name}</span>
        <NumberInput
          id={`${idPrefix}-${unit.name}`}
          className="tl-form__date-input"
          value={value[unit.name] ?? 1}
          onValueChange={(next) => onChange(clampTimelineDate({ ...value, [unit.name]: next ?? 1 }, calendar))}
          min={1}
          max={dateUnitMax(calendar, value, unit.name)}
          inputMode="numeric"
        />
      </label>
    ))}
  </div>
);

export default DateFieldsInput;

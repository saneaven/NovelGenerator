import React, { useCallback, useEffect, useState } from 'react';
import BaseModal from '../../../components/BaseModal/BaseModal';
import { NumberInput } from '../../../components/ui/NumberInput';
import { Plus, Trash, Timeline } from '../../../components/icons';
import { useTimelineStore } from '../../../store/timelineStore';
import type { CalendarConfig, CalendarUnit } from '../../../types/timeline';
import { formatDate, fromBaseUnits } from '../../../utils/timelineCalendar';
import './CalendarConfigModal.css';

interface CalendarConfigModalProps {
  isOpen: boolean;
  projectId: string;
  calendar: CalendarConfig;
  displayLanguage: string;
  onClose: () => void;
}

const CalendarConfigModal: React.FC<CalendarConfigModalProps> = ({
  isOpen,
  projectId,
  calendar,
  displayLanguage,
  onClose,
}) => {
  const updateCalendar = useTimelineStore((s) => s.updateCalendar);
  const [units, setUnits] = useState<CalendarUnit[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setUnits(calendar.units.map((u) => ({ ...u })));
    }
  }, [isOpen, calendar]);

  const handleUnitChange = useCallback((index: number, field: keyof CalendarUnit, value: string | number | undefined) => {
    setUnits((prev) => {
      const next = prev.map((u) => ({ ...u }));
      if (field === 'count') {
        next[index].count = value as number | undefined;
      } else {
        (next[index] as Record<string, unknown>)[field] = value;
      }
      return next;
    });
  }, []);

  const handleAddUnit = useCallback(() => {
    setUnits((prev) => {
      const next = prev.map((u) => ({ ...u }));
      // Make the current last unit non-terminal
      if (next.length > 0 && !next[next.length - 1].count) {
        next[next.length - 1].count = 10;
      }
      next.push({ name: 'unit', label: 'Unit' });
      return next;
    });
  }, []);

  const handleRemoveUnit = useCallback((index: number) => {
    setUnits((prev) => {
      if (prev.length <= 2) return prev; // minimum 2 units
      const next = prev.filter((_, i) => i !== index);
      // Ensure last unit has no count (terminal)
      if (next.length > 0) {
        delete next[next.length - 1].count;
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (units.length < 2) return;
    setIsSaving(true);
    try {
      const nextCalendar: CalendarConfig = calendar.mode ? { mode: calendar.mode, units } : { units };
      await updateCalendar(projectId, nextCalendar, displayLanguage);
      onClose();
    } finally {
      setIsSaving(false);
    }
  }, [units, calendar.mode, projectId, displayLanguage, updateCalendar, onClose]);

  // Preview: format a sample date
  const samplePreview = (() => {
    try {
      if (units.length === 0) return '';
      const previewCalendar: CalendarConfig = calendar.mode ? { mode: calendar.mode, units } : { units };
      const sampleDate = fromBaseUnits(42, previewCalendar);
      return formatDate(sampleDate, previewCalendar);
    } catch {
      return 'Invalid configuration';
    }
  })();

  const isValid = units.length >= 2
    && units.every((u) => u.name.trim().length > 0 && u.label.trim().length > 0)
    && units.slice(0, -1).every((u) => u.count && u.count > 0);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Calendar Configuration"
      titleIcon={<Timeline size="md" />}
      size="medium"
      footer={
        <div className="calendar-config__footer">
          <button
            type="button"
            className="timeline-event-sidebar__btn timeline-event-sidebar__btn--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="timeline-event-sidebar__btn timeline-event-sidebar__btn--primary"
            onClick={handleSave}
            disabled={isSaving || !isValid}
          >
            Save
          </button>
        </div>
      }
    >
      <div className="calendar-config">
        <div className="calendar-config__warning">
          Changing the calendar structure will migrate all existing event dates.
          Some precision may be lost if units are removed.
        </div>

        <div className="calendar-config__units">
          <div className="calendar-config__units-header">
            <span>Name</span>
            <span>Label</span>
            <span>Contains</span>
            <span />
          </div>

          {units.map((unit, index) => {
            const isLast = index === units.length - 1;
            return (
              <div key={index} className="calendar-config__unit-row">
                <input
                  className="calendar-config__unit-input"
                  value={unit.name}
                  onChange={(e) => handleUnitChange(index, 'name', e.target.value.toLowerCase().replace(/\s/g, '_'))}
                  placeholder="name"
                />
                <input
                  className="calendar-config__unit-input"
                  value={unit.label}
                  onChange={(e) => handleUnitChange(index, 'label', e.target.value)}
                  placeholder="Label"
                />
                {isLast ? (
                  <span className="calendar-config__unit-terminal">base unit</span>
                ) : (
                  <div className="calendar-config__unit-count">
                    <NumberInput
                      className="calendar-config__unit-input calendar-config__unit-input--count"
                      value={unit.count}
                      onValueChange={(v) => handleUnitChange(index, 'count', v)}
                      min={1}
                    />
                    <span className="calendar-config__unit-count-suffix">
                      {units[index + 1]?.label || 'next'}s
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  className="calendar-config__unit-remove"
                  onClick={() => handleRemoveUnit(index)}
                  disabled={units.length <= 2}
                  title="Remove unit"
                >
                  <Trash size="sm" />
                </button>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          className="calendar-config__add-btn"
          onClick={handleAddUnit}
        >
          <Plus size="sm" />
          Add Unit
        </button>

        {samplePreview && (
          <div className="calendar-config__preview">
            <span className="calendar-config__preview-label">Sample:</span>
            <span className="calendar-config__preview-value">{samplePreview}</span>
          </div>
        )}
      </div>
    </BaseModal>
  );
};

export default CalendarConfigModal;

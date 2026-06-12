import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarConfig } from '../../../types/timeline';
import type { BreakRowData } from '../layout/types';
import { formatBreakText } from './streamText';

interface BreakSeparatorProps {
  row: BreakRowData;
  calendar: CalendarConfig;
  registerRowElement: (key: string, el: HTMLElement | null) => void;
  onJumpToEvent: (eventId: string) => void;
}

const MAX_ERA_NAMES = 2;

/** ═══ N years later ═══ — an explicit narrated time skip between anchors. */
const BreakSeparator: React.FC<BreakSeparatorProps> = ({ row, calendar, registerRowElement, onJumpToEvent }) => {
  const { t } = useTranslation();
  const text = formatBreakText(row.count, row.unitLabel, calendar, t);

  const refCallback = useCallback(
    (el: HTMLElement | null) => registerRowElement(row.key, el),
    [registerRowElement, row.key],
  );

  const shownEras = row.continuingEras.slice(0, MAX_ERA_NAMES);
  const extraEras = row.continuingEras.length - shownEras.length;

  return (
    <li
      ref={refCallback}
      className="tl-break"
      role="separator"
      style={{ marginTop: row.gapBefore }}
    >
      <div className="tl-break__line-row">
        <span className="tl-break__line" aria-hidden="true" />
        <span className="tl-break__pill">{text}</span>
        <span className="tl-break__line" aria-hidden="true" />
      </div>
      {shownEras.length > 0 && (
        <div className="tl-break__eras">
          {shownEras.map((era) => (
            <button
              key={era.eventId}
              type="button"
              className="tl-break__era"
              onClick={() => onJumpToEvent(era.eventId)}
            >
              ⟐ {t('timeline.break.continues', { name: era.name })}
            </button>
          ))}
          {extraEras > 0 && (
            <span className="tl-break__era tl-break__era--more">
              {t('timeline.break.continuesMore', { count: extraEras })}
            </span>
          )}
        </div>
      )}
    </li>
  );
};

export default React.memo(BreakSeparator);

import React from 'react';
import type { TimelineEvent } from '../../../types/timeline';
import type { TrackColorSet } from '../timelineColors';
import './TimelineEvent.css';

interface TimelineEventBarProps {
  event: TimelineEvent;
  left: number;
  width: number;
  colors: TrackColorSet;
  isSelected: boolean;
  displayLanguage: string;
  onClick: (event: TimelineEvent) => void;
}

const TimelineEventBar: React.FC<TimelineEventBarProps> = ({
  event,
  left,
  width,
  colors,
  isSelected,
  displayLanguage,
  onClick,
}) => {
  const name = (event.data?.[displayLanguage] as Record<string, unknown>)?.name as string
    || (Object.values(event.data ?? {})[0] as Record<string, unknown>)?.name as string
    || 'Untitled';

  const showLabel = width >= 60;

  return (
    <div
      className={`timeline-event-bar${isSelected ? ' timeline-event-bar--selected' : ''}`}
      style={{
        left,
        width,
        background: colors.barBg,
        borderColor: colors.barBorder,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      title={name}
    >
      {showLabel && <span className="timeline-event-bar__label">{name}</span>}
      {event.tags.length > 0 && (
        <span className="timeline-event-bar__tags">
          {event.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="timeline-event-bar__tag-dot"
              title={tag}
            />
          ))}
        </span>
      )}
    </div>
  );
};

export default React.memo(TimelineEventBar);

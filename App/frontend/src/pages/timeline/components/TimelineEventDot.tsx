import React, { useState } from 'react';
import type { TimelineEvent } from '../../../types/timeline';
import type { TrackColorSet } from '../timelineColors';
import './TimelineEvent.css';

interface TimelineEventDotProps {
  event: TimelineEvent;
  left: number;
  colors: TrackColorSet;
  isSelected: boolean;
  displayLanguage: string;
  onClick: (event: TimelineEvent) => void;
}

const TimelineEventDot: React.FC<TimelineEventDotProps> = ({
  event,
  left,
  colors,
  isSelected,
  displayLanguage,
  onClick,
}) => {
  const [hovered, setHovered] = useState(false);
  const name = (event.data?.[displayLanguage] as Record<string, unknown>)?.name as string
    || (Object.values(event.data ?? {})[0] as Record<string, unknown>)?.name as string
    || 'Untitled';

  return (
    <div
      className={`timeline-event-dot${isSelected ? ' timeline-event-dot--selected' : ''}`}
      style={{
        left,
        background: colors.labelBar,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(event);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={name}
    >
      {(hovered || isSelected) && (
        <span className="timeline-event-dot__label">{name}</span>
      )}
    </div>
  );
};

export default React.memo(TimelineEventDot);

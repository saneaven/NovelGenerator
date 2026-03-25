import React from 'react';
import { Timeline, Plus, Settings } from '../../../components/icons';

interface TimelineEmptyStateProps {
  onCreateTrack: () => void;
  onConfigureCalendar: () => void;
}

const TimelineEmptyState: React.FC<TimelineEmptyStateProps> = ({
  onCreateTrack,
  onConfigureCalendar,
}) => {
  return (
    <div className="timeline-empty-state">
      <div className="timeline-empty-state__content">
        <Timeline size="lg" className="timeline-empty-state__icon" />
        <h4 className="timeline-empty-state__title">No timeline yet</h4>
        <p className="timeline-empty-state__description">
          Create tracks to organize events along your story's timeline.
        </p>
        <button
          type="button"
          className="timeline-empty-state__cta"
          onClick={onCreateTrack}
        >
          <Plus size="sm" />
          Create First Track
        </button>
        <button
          type="button"
          className="timeline-empty-state__link"
          onClick={onConfigureCalendar}
        >
          <Settings size="sm" />
          Configure Calendar
        </button>
      </div>
    </div>
  );
};

export default TimelineEmptyState;

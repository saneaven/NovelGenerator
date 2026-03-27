import React from 'react';
import { Plus, Settings, Expand, ChevronLeft, ChevronRight } from '../../../components/icons';
import './TimelineToolbar.css';

interface TimelineToolbarProps {
  zoomLabel: string;
  onCreateTrack: () => void;
  onConfigureCalendar: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitAll: () => void;
}

const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
  zoomLabel,
  onCreateTrack,
  onConfigureCalendar,
  onZoomIn,
  onZoomOut,
  onFitAll,
}) => {
  return (
    <div className="timeline-toolbar">
      <div className="timeline-toolbar__left">
        <button
          type="button"
          className="timeline-toolbar__btn timeline-toolbar__btn--primary"
          onClick={onCreateTrack}
        >
          <Plus size="sm" />
          <span>Track</span>
        </button>
      </div>

      <div className="timeline-toolbar__right">
        <button
          type="button"
          className="timeline-toolbar__btn timeline-toolbar__btn--icon"
          onClick={onConfigureCalendar}
          title="Calendar Settings"
        >
          <Settings size="sm" />
        </button>

        <div className="timeline-toolbar__zoom">
          <button
            type="button"
            className="timeline-toolbar__zoom-btn"
            onClick={onZoomOut}
            title="Zoom Out"
          >
            <ChevronLeft size="sm" />
          </button>
          <span className="timeline-toolbar__zoom-label">{zoomLabel}</span>
          <button
            type="button"
            className="timeline-toolbar__zoom-btn"
            onClick={onZoomIn}
            title="Zoom In"
          >
            <ChevronRight size="sm" />
          </button>
        </div>

        <button
          type="button"
          className="timeline-toolbar__btn timeline-toolbar__btn--icon"
          onClick={onFitAll}
          title="Fit All Events"
        >
          <Expand size="sm" />
        </button>
      </div>
    </div>
  );
};

export default React.memo(TimelineToolbar);

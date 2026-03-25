import React from 'react';
import type { RulerTick } from '../hooks/useTimelinePositioning';
import './TimelineRuler.css';

interface TimelineRulerProps {
  ticks: RulerTick[];
  canvasWidth: number;
}

const TimelineRuler: React.FC<TimelineRulerProps> = ({ ticks, canvasWidth }) => {
  return (
    <div className="timeline-ruler" style={{ width: canvasWidth }}>
      {ticks.map((tick) => (
        <div
          key={tick.basePosition}
          className={`timeline-ruler__tick timeline-ruler__tick--${tick.level}`}
          style={{ left: tick.position }}
        >
          <div className="timeline-ruler__line" />
          <span className="timeline-ruler__label">{tick.label}</span>
        </div>
      ))}
    </div>
  );
};

export default React.memo(TimelineRuler);

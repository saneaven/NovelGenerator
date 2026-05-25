import React from 'react';
import './TimelineDisplays.css';

export interface TimelineLinkDisplayProps {
  /** Event display name, falling back to its id. */
  eventLabel: string;
  /** Linked object type, e.g. "story_entity" / "outline". */
  objectType?: string;
  /** Linked object display name, falling back to its id. */
  objectLabel?: string;
  mode: 'create' | 'delete';
}

export const TimelineLinkDisplay: React.FC<TimelineLinkDisplayProps> = ({
  eventLabel,
  objectType,
  objectLabel,
  mode,
}) => (
  <div className={`tl-link${mode === 'delete' ? ' tl-link--delete' : ''}`}>
    <span className="tl-link__icon" aria-hidden>⛓</span>
    <span className="tl-link__event">{eventLabel}</span>
    <span className="tl-link__arrow" aria-hidden>⇄</span>
    <span className="tl-link__target">
      {objectType && <span className="tl-link__target-type">{objectType}</span>}
      {objectLabel}
    </span>
  </div>
);

export default TimelineLinkDisplay;

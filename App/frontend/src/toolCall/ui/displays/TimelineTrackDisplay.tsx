import React from 'react';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { getTrackColors } from '../../../pages/timeline/timelineColors';
import './TimelineDisplays.css';

export type TimelineDisplayMode = 'read' | 'create' | 'replace' | 'delete';

export interface TimelineTrackDisplayProps {
  name: string;
  color?: string | null;
  parentId?: string | null;
  /** Resolved parent track name; omit / empty => root track. */
  parentLabel?: string;
  position?: number;
  description?: string;
  contentMarkdown?: string;
  childTrackIds?: string[];
  eventIds?: string[];
  mode: TimelineDisplayMode;
  changedFields?: string[];
}

export const TimelineTrackDisplay: React.FC<TimelineTrackDisplayProps> = ({
  name,
  color,
  parentId,
  parentLabel,
  position,
  description,
  contentMarkdown,
  childTrackIds,
  eventIds,
  mode,
  changedFields,
}) => {
  const colors = getTrackColors(color);
  const isChanged = (field: string) => mode === 'replace' && Boolean(changedFields?.includes(field));
  const show = (field: string) => mode !== 'replace' || !changedFields || changedFields.includes(field);

  const hasContent = Boolean(contentMarkdown && contentMarkdown.trim());
  const hasDescription = Boolean(description && description.trim());
  const childIds = (childTrackIds ?? []).map((id) => id.trim()).filter(Boolean);
  const eventIdList = (eventIds ?? []).map((id) => id.trim()).filter(Boolean);
  const showChildRefs = show('childTrackIds') && childIds.length > 0;
  const showEventRefs = show('eventIds') && eventIdList.length > 0;

  return (
    <div className="tl-card tl-card--track" style={{ ['--tl-accent' as string]: colors.labelBar }}>
      <span className="tl-card__accent" aria-hidden />
      <div className="tl-card__body">
        {show('name') && (
          <div className={`tl-card__title-row${isChanged('name') ? ' tl-card--changed' : ''}`}>
            <span className="tl-card__title">{name || 'Untitled track'}</span>
          </div>
        )}

        <div className="tl-card__meta-row">
          {show('color') && (
            <span className={`tl-chip tl-chip--color${isChanged('color') ? ' tl-card--changed' : ''}`}>
              <span
                className="tl-chip__swatch"
                style={{ background: color ?? 'var(--color-border-strong)' }}
                aria-hidden
              />
              {color ?? 'auto'}
            </span>
          )}
          {show('position') && typeof position === 'number' && (
            <span className="tl-card__meta-item">position {position}</span>
          )}
          {show('parentId') && (
            <span className={`tl-card__meta-item${isChanged('parentId') ? ' tl-card--changed' : ''}`}>
              {parentLabel ? `parent: ${parentLabel}` : parentId ? `parent: ${parentId}` : 'root track'}
            </span>
          )}
        </div>

        {(showChildRefs || showEventRefs) && (
          <div className="tl-card__refs">
            {showChildRefs && (
              <div className="tl-card__ref-group">
                <span className="tl-card__refs-label">childTrackIds</span>
                {childIds.map((id) => (
                  <span key={id} className="tl-card__ref-id">{id}</span>
                ))}
              </div>
            )}
            {showEventRefs && (
              <div className="tl-card__ref-group">
                <span className="tl-card__refs-label">eventIds</span>
                {eventIdList.map((id) => (
                  <span key={id} className="tl-card__ref-id">{id}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {show('description') && hasDescription && (
          <p className={`tl-card__description${isChanged('description') ? ' tl-card--changed' : ''}`}>{description}</p>
        )}

        {show('content') && hasContent && (
          <div className={`tl-card__content${isChanged('content') ? ' tl-card--changed' : ''}`}>
            <MarkdownRenderer>{contentMarkdown as string}</MarkdownRenderer>
          </div>
        )}
      </div>
    </div>
  );
};

export default TimelineTrackDisplay;

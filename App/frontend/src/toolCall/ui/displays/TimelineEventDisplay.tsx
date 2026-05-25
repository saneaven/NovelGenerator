import React from 'react';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { getTrackColors, presetSwatch } from '../../../pages/timeline/timelineColors';
import type { TimelineDisplayMode } from './TimelineTrackDisplay';
import './TimelineDisplays.css';

export interface TimelineEventDisplayProps {
  name: string;
  trackColor?: string | null;
  trackLabel?: string;
  startLabel?: string;
  /** Omit => single point in time (no range). */
  endLabel?: string;
  tags?: string[];
  linkCount?: number;
  description?: string;
  contentMarkdown?: string;
  mode: TimelineDisplayMode;
  changedFields?: string[];
}

export const TimelineEventDisplay: React.FC<TimelineEventDisplayProps> = ({
  name,
  trackColor,
  trackLabel,
  startLabel,
  endLabel,
  tags,
  linkCount,
  description,
  contentMarkdown,
  mode,
  changedFields,
}) => {
  const colors = getTrackColors(trackColor);
  const isChanged = (field: string) => mode === 'replace' && Boolean(changedFields?.includes(field));
  const show = (field: string) => mode !== 'replace' || !changedFields || changedFields.includes(field);

  const tagList = (tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  const hasContent = Boolean(contentMarkdown && contentMarkdown.trim());
  const hasDescription = Boolean(description && description.trim());
  const showDates = show('startDate') || show('endDate');

  return (
    <div
      className="tl-card tl-card--event"
      style={{
        ['--tl-bar-bg' as string]: colors.barBg,
        ['--tl-bar-border' as string]: colors.barBorder,
        ['--tl-accent' as string]: colors.labelBar,
      }}
    >
      {show('name') && (
        <div className={`tl-event-bar${isChanged('name') ? ' tl-card--changed' : ''}`}>
          <span className="tl-event-bar__label">{name || 'Untitled event'}</span>
        </div>
      )}

      {showDates && (
        <div className={`tl-card__date-row${isChanged('startDate') || isChanged('endDate') ? ' tl-card--changed' : ''}`}>
          <span className="tl-card__date-icon" aria-hidden>📅</span>
          {startLabel ? (
            <span className="tl-card__date">{startLabel}</span>
          ) : (
            <span className="tl-card__date tl-card__date--empty">no start date</span>
          )}
          {endLabel ? (
            <>
              <span className="tl-card__date-arrow" aria-hidden>→</span>
              <span className="tl-card__date">{endLabel}</span>
            </>
          ) : startLabel ? (
            <span className="tl-card__point-tag">single point</span>
          ) : null}
        </div>
      )}

      {trackLabel && (
        <div className="tl-card__meta-row">
          <span className="tl-chip tl-chip--color">
            <span className="tl-chip__swatch" style={{ background: presetSwatch(trackColor ?? 'neutral') }} aria-hidden />
            {trackLabel}
          </span>
        </div>
      )}

      {(show('tags') || (linkCount ?? 0) > 0) && (tagList.length > 0 || (linkCount ?? 0) > 0) && (
        <div className={`tl-card__tag-row${isChanged('tags') ? ' tl-card--changed' : ''}`}>
          {show('tags') && tagList.map((tag) => (
            <span key={tag} className="tl-chip tl-chip--tag">{tag}</span>
          ))}
          {(linkCount ?? 0) > 0 && (
            <span className="tl-card__links">⛓ {linkCount} link{linkCount === 1 ? '' : 's'}</span>
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
  );
};

export default TimelineEventDisplay;

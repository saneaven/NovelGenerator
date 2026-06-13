import React, { useCallback } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import TextButton from '../../../components/TextButton/TextButton';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { ChevronDown, Clock, Edit, Hash, Trash } from '../../../components/icons';
import type { ObjectPickerItem } from '../../../components/ObjectPicker/types';
import type { CalendarConfig } from '../../../types/timeline';
import type { TimelineEventLink } from '../../../types/timeline';
import { getAnyObjectTypeLabel } from '../../../types/timeline';
import type { AnyObjectType } from '../../../types/unifiedObject';
import { formatDate } from '../../../utils/timelineCalendar';
import type { VisibleEvent } from '../layout/types';
import { trackColorProps } from '../timelineColors';
import { spanDuration } from './streamText';
import TrackBadge from './TrackBadge';
import './EventCard.css';

interface EventCardProps {
  ve: VisibleEvent;
  calendar: CalendarConfig;
  expanded: boolean;
  highlighted?: boolean;
  linkItems: ReadonlyMap<string, ObjectPickerItem>;
  onToggle: (eventId: string) => void;
  onEdit: (ve: VisibleEvent) => void;
  onDelete: (ve: VisibleEvent) => void;
  onTagClick: (tag: string) => void;
  onNavigateLink: (link: TimelineEventLink) => void;
  onAnimationStateChange: (animating: boolean) => void;
}

const EXPAND_TRANSITION = { duration: 0.24, ease: [0.4, 0, 0.2, 1] as const };

const EventCard: React.FC<EventCardProps> = ({
  ve,
  calendar,
  expanded,
  highlighted = false,
  linkItems,
  onToggle,
  onEdit,
  onDelete,
  onTagClick,
  onNavigateLink,
  onAnimationStateChange,
}) => {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion();
  const { event, name, description } = ve;

  const duration = spanDuration(ve, calendar, t);
  const fullPath = ve.trackPath.map((entry) => entry.name || '—').join(' › ');
  const contentMarkdown = ve.contentMarkdown.trim();

  const handleHeaderKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && expanded) {
      e.stopPropagation();
      onToggle(event.id);
    }
  }, [expanded, onToggle, event.id]);

  const colorProps = trackColorProps(ve.colorKey);

  return (
    <article
      className={[
        'tl-card',
        colorProps.className,
        expanded && 'tl-card--expanded',
        highlighted && 'tl-card--flash',
      ].filter(Boolean).join(' ')}
      style={colorProps.style}
      data-event-id={event.id}
      onKeyDown={handleHeaderKeyDown}
    >
      <button
        type="button"
        className="tl-card__header"
        aria-expanded={expanded}
        aria-controls={`tl-card-body-${event.id}`}
        onClick={() => onToggle(event.id)}
        title={expanded ? t('timeline.card.collapse') : t('timeline.card.expand')}
      >
        <span className="tl-card__title-row">
          <span className="tl-card__name">{name || t('timeline.card.untitled')}</span>
          {duration !== null && (
            <span className="tl-card__chip" title={t('timeline.card.until', { date: event.endDate ? formatDate(event.endDate, calendar) : '' })}>
              ⇣ {duration}
            </span>
          )}
          <span className="tl-card__spacer" />
          <TrackBadge trackPath={ve.trackPath} colorKey={ve.colorKey} />
          <ChevronDown size="sm" className={`tl-card__chevron ${expanded ? 'tl-card__chevron--open' : ''}`} />
        </span>
        {!expanded && description && (
          <span className="tl-card__desc-preview">{description}</span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            id={`tl-card-body-${event.id}`}
            className="tl-card__body"
            initial={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
            animate={reducedMotion ? { opacity: 1 } : { height: 'auto', opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0, y: -4 }}
            transition={reducedMotion ? { duration: 0.12 } : EXPAND_TRANSITION}
            onAnimationStart={() => onAnimationStateChange(true)}
            onAnimationComplete={() => onAnimationStateChange(false)}
          >
            <div className="tl-card__body-inner">
              <div className="tl-card__full-path">{fullPath}</div>

              <div className="tl-card__time">
                <Clock size="sm" className="tl-card__time-icon" />
                <div className="tl-card__time-lines">
                  <span className="tl-card__time-line">{formatDate(event.startDate, calendar)}</span>
                  {event.endDate && (
                    <span className="tl-card__time-line tl-card__time-line--end">
                      → {formatDate(event.endDate, calendar)}
                      {duration !== null && <span className="tl-card__time-duration"> ({duration})</span>}
                    </span>
                  )}
                </div>
              </div>

              {description && <p className="tl-card__description">{description}</p>}

              {contentMarkdown && (
                <MarkdownRenderer className="markdown-content tl-card__content">
                  {contentMarkdown}
                </MarkdownRenderer>
              )}

              {event.tags.length > 0 && (
                <div className="tl-card__tags">
                  {event.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      className="tl-card__tag"
                      onClick={() => onTagClick(tag)}
                      title={t('timeline.filter.button')}
                    >
                      <Hash size="xs" />
                      {tag}
                    </button>
                  ))}
                </div>
              )}

              {event.links.length > 0 && (
                <div className="tl-card__links">
                  <span className="tl-card__links-label">{t('timeline.card.links')}</span>
                  {event.links.map((link) => (
                    <button
                      key={link.id}
                      type="button"
                      className="tl-card__link"
                      onClick={() => onNavigateLink(link)}
                    >
                      <span className="tl-card__link-type">
                        {getAnyObjectTypeLabel(link.objectType as AnyObjectType)}
                      </span>
                      <span className="tl-card__link-name">
                        {linkItems.get(link.objectId)?.name ?? link.objectId}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              <div className="tl-card__actions">
                <TextButton variant="ghost" size="sm" iconLeft={<Trash size="sm" />} onClick={() => onDelete(ve)} className="tl-card__delete">
                  {t('common.delete')}
                </TextButton>
                <TextButton variant="primary" size="sm" iconLeft={<Edit size="sm" />} onClick={() => onEdit(ve)}>
                  {t('common.edit')}
                </TextButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
};

export default React.memo(EventCard);

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { Plus } from '../../../components/icons';
import type { ObjectPickerItem } from '../../../components/ObjectPicker/types';
import type { CalendarConfig, TimelineDate, TimelineEventLink } from '../../../types/timeline';
import type { AnchorRowData, VisibleEvent } from '../layout/types';
import { trackColorProps } from '../timelineColors';
import EventCluster from './EventCluster';

interface AnchorRowProps {
  row: AnchorRowData;
  calendar: CalendarConfig;
  displayLanguage: string;
  collapseAt: number;
  clusterExpanded: boolean;
  expandedEventId: string | null;
  highlightedEventId: string | null;
  overflowSpans: VisibleEvent[] | undefined;
  linkItems: ReadonlyMap<string, ObjectPickerItem>;
  registerRowElement: (key: string, el: HTMLElement | null) => void;
  onExpandCluster: (anchorKey: string) => void;
  onToggleEvent: (eventId: string) => void;
  onEditEvent: (ve: VisibleEvent) => void;
  onDeleteEvent: (ve: VisibleEvent) => void;
  onTagClick: (tag: string) => void;
  onNavigateLink: (link: TimelineEventLink) => void;
  onQuickAdd: (date: TimelineDate) => void;
  onJumpToEvent: (eventId: string) => void;
  onAnimationStateChange: (animating: boolean) => void;
}

const AnchorRow: React.FC<AnchorRowProps> = ({
  row,
  calendar,
  displayLanguage,
  collapseAt,
  clusterExpanded,
  expandedEventId,
  highlightedEventId,
  overflowSpans,
  linkItems,
  registerRowElement,
  onExpandCluster,
  onToggleEvent,
  onEditEvent,
  onDeleteEvent,
  onTagClick,
  onNavigateLink,
  onQuickAdd,
  onJumpToEvent,
  onAnimationStateChange,
}) => {
  const { t } = useTranslation();

  const nodeRef = useCallback(
    (el: HTMLElement | null) => registerRowElement(row.key, el),
    [registerRowElement, row.key],
  );

  const hasStarts = row.starts.length > 0;
  const nodeColor = trackColorProps(row.dominantColorKey);

  const label = row.labelParts.map((part) => (
    <span key={part.rank} className={`tl-anchor__label-part tl-anchor__label-part--rank-${Math.min(part.rank, 3)}`}>
      {part.text}
    </span>
  ));

  const quickAdd = (
    <button
      type="button"
      className="tl-anchor__quick-add"
      onClick={() => onQuickAdd(row.date)}
      title={t('timeline.card.addAtThisTime')}
      aria-label={t('timeline.card.addAtThisTime')}
    >
      <Plus size="xs" />
    </button>
  );

  return (
    <li
      className={`tl-anchor tl-anchor--rank-${Math.min(row.labelRank, 2)}`}
      style={{ marginTop: row.gapBefore }}
      data-anchor-key={row.key}
    >
      <div className="tl-anchor__gutter" title={row.fullLabel}>
        {label}
        {quickAdd}
      </div>

      <div className="tl-anchor__spine-col">
        <span
          ref={nodeRef}
          className={[
            'tl-anchor__node',
            nodeColor.className,
            !hasStarts && 'tl-anchor__node--ghost',
          ].filter(Boolean).join(' ')}
          style={nodeColor.style}
          aria-hidden="true"
        />
        {overflowSpans && overflowSpans.length > 0 && (
          <DropdownMenu
            align="left"
            trigger={
              <button type="button" className="tl-anchor__overflow-pill" title={t('timeline.card.ongoingCount', { count: overflowSpans.length })}>
                +{overflowSpans.length}
              </button>
            }
          >
            {overflowSpans.map((ve) => (
              <DropdownItem
                key={ve.event.id}
                label={ve.name || t('timeline.card.untitled')}
                onClick={() => onJumpToEvent(ve.event.id)}
              />
            ))}
          </DropdownMenu>
        )}
      </div>

      <div className="tl-anchor__content">
        <div className="tl-anchor__label-mobile" title={row.fullLabel}>
          {label}
        </div>

        {hasStarts && (
          <EventCluster
            starts={row.starts}
            anchorKey={row.key}
            collapseAt={collapseAt}
            clusterExpanded={clusterExpanded}
            calendar={calendar}
            displayLanguage={displayLanguage}
            expandedEventId={expandedEventId}
            highlightedEventId={highlightedEventId}
            linkItems={linkItems}
            onExpandCluster={onExpandCluster}
            onToggleEvent={onToggleEvent}
            onEditEvent={onEditEvent}
            onDeleteEvent={onDeleteEvent}
            onTagClick={onTagClick}
            onNavigateLink={onNavigateLink}
            onAnimationStateChange={onAnimationStateChange}
          />
        )}

        {row.ends.map((ve) => (
          <button
            key={`end-${ve.event.id}`}
            type="button"
            className={`tl-anchor__ghost-end ${trackColorProps(ve.colorKey).className}`}
            style={trackColorProps(ve.colorKey).style}
            onClick={() => onJumpToEvent(ve.event.id)}
          >
            <span className="tl-anchor__ghost-dot" aria-hidden="true" />
            {t('timeline.card.endsMarker', { name: ve.name || t('timeline.card.untitled') })}
          </button>
        ))}
      </div>
    </li>
  );
};

export default React.memo(AnchorRow);

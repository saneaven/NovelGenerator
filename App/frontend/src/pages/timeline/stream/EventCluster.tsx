import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ObjectPickerItem } from '../../../components/ObjectPicker/types';
import type { CalendarConfig, TimelineEventLink } from '../../../types/timeline';
import type { VisibleEvent } from '../layout/types';
import EventCard from './EventCard';

interface EventClusterProps {
  starts: VisibleEvent[];
  anchorKey: string;
  collapseAt: number;
  clusterExpanded: boolean;
  calendar: CalendarConfig;
  expandedEventId: string | null;
  highlightedEventId: string | null;
  linkItems: ReadonlyMap<string, ObjectPickerItem>;
  onExpandCluster: (anchorKey: string) => void;
  onToggleEvent: (eventId: string) => void;
  onEditEvent: (ve: VisibleEvent) => void;
  onDeleteEvent: (ve: VisibleEvent) => void;
  onTagClick: (tag: string) => void;
  onNavigateLink: (link: TimelineEventLink) => void;
  onAnimationStateChange: (animating: boolean) => void;
}

/** Same-time stack: shows the first N cards collapsed, `Show all (N)` reveals the rest. */
const EventCluster: React.FC<EventClusterProps> = ({
  starts,
  anchorKey,
  collapseAt,
  clusterExpanded,
  onExpandCluster,
  ...cardProps
}) => {
  const { t } = useTranslation();
  const collapsed = !clusterExpanded && starts.length > collapseAt;
  const shown = collapsed ? starts.slice(0, collapseAt - 1) : starts;

  return (
    <div className="tl-cluster">
      {shown.map((ve) => (
        <div className="tl-cluster__item" key={ve.event.id}>
          <EventCard
            ve={ve}
            expanded={cardProps.expandedEventId === ve.event.id}
            highlighted={cardProps.highlightedEventId === ve.event.id}
            calendar={cardProps.calendar}
            linkItems={cardProps.linkItems}
            onToggle={cardProps.onToggleEvent}
            onEdit={cardProps.onEditEvent}
            onDelete={cardProps.onDeleteEvent}
            onTagClick={cardProps.onTagClick}
            onNavigateLink={cardProps.onNavigateLink}
            onAnimationStateChange={cardProps.onAnimationStateChange}
          />
        </div>
      ))}
      {collapsed && (
        <button
          type="button"
          className="tl-cluster__show-all"
          onClick={() => onExpandCluster(anchorKey)}
        >
          {t('timeline.card.showAllCluster', { count: starts.length })}
        </button>
      )}
    </div>
  );
};

export default React.memo(EventCluster);

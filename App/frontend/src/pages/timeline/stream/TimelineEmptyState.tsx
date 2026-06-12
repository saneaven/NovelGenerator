import React from 'react';
import { useTranslation } from 'react-i18next';
import TextButton from '../../../components/TextButton/TextButton';
import { Plus, Timeline } from '../../../components/icons';

export type EmptyStateKind = 'no-tracks' | 'no-events' | 'all-hidden' | 'no-matches';

interface TimelineEmptyStateProps {
  kind: EmptyStateKind;
  onCreateTrack: () => void;
  onCreateEvent: () => void;
  onShowAllTracks: () => void;
  onClearFilters: () => void;
}

const TimelineEmptyState: React.FC<TimelineEmptyStateProps> = ({
  kind,
  onCreateTrack,
  onCreateEvent,
  onShowAllTracks,
  onClearFilters,
}) => {
  const { t } = useTranslation();

  const content: Record<EmptyStateKind, { title: string; body: string; action: React.ReactNode }> = {
    'no-tracks': {
      title: t('timeline.empty.noTracksTitle'),
      body: t('timeline.empty.noTracksBody'),
      action: (
        <TextButton variant="primary" iconLeft={<Plus size="sm" />} onClick={onCreateTrack}>
          {t('timeline.empty.createFirstTrack')}
        </TextButton>
      ),
    },
    'no-events': {
      title: t('timeline.empty.noEventsTitle'),
      body: t('timeline.empty.noEventsBody'),
      action: (
        <div className="tl-empty__actions">
          <TextButton variant="primary" iconLeft={<Plus size="sm" />} onClick={onCreateEvent}>
            {t('timeline.empty.createFirstEvent')}
          </TextButton>
          <TextButton variant="ghost" onClick={onCreateTrack}>
            {t('timeline.empty.manageTracks')}
          </TextButton>
        </div>
      ),
    },
    'all-hidden': {
      title: t('timeline.empty.allHiddenTitle'),
      body: t('timeline.empty.allHiddenBody'),
      action: (
        <TextButton variant="secondary" onClick={onShowAllTracks}>
          {t('timeline.showAll')}
        </TextButton>
      ),
    },
    'no-matches': {
      title: t('timeline.empty.noMatchesTitle'),
      body: '',
      action: (
        <TextButton variant="secondary" onClick={onClearFilters}>
          {t('timeline.empty.clearFilters')}
        </TextButton>
      ),
    },
  };

  const { title, body, action } = content[kind];

  return (
    <div className="tl-empty">
      <span className="tl-empty__icon"><Timeline size="xl" /></span>
      <h3 className="tl-empty__title">{title}</h3>
      {body && <p className="tl-empty__body">{body}</p>}
      {action}
    </div>
  );
};

export default TimelineEmptyState;

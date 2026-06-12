import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import TextButton from '../../../components/TextButton/TextButton';
import { DropdownMenu, DropdownItem, DropdownDivider } from '../../../components/ui/DropdownMenu';
import { Check, ChevronDown, Close, Hash, Plus, Search, Timeline } from '../../../components/icons';
import './TimelineToolbar.css';

interface TimelineToolbarProps {
  onCreateEvent: () => void;
  onOpenCalendar: () => void;
  onJumpStart: () => void;
  onJumpEnd: () => void;
  onJumpToDate: () => void;
  allTags: string[];
  activeTags: string[];
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  hiddenTrackCount: number;
  onShowAllTracks: () => void;
}

const TAG_SEARCH_THRESHOLD = 10;

const TimelineToolbar: React.FC<TimelineToolbarProps> = ({
  onCreateEvent,
  onOpenCalendar,
  onJumpStart,
  onJumpEnd,
  onJumpToDate,
  allTags,
  activeTags,
  onToggleTag,
  onClearTags,
  hiddenTrackCount,
  onShowAllTracks,
}) => {
  const { t } = useTranslation();
  const [tagSearch, setTagSearch] = useState('');

  const filteredTags = tagSearch
    ? allTags.filter((tag) => tag.toLowerCase().includes(tagSearch.toLowerCase()))
    : allTags;

  return (
    <div className="tl-toolbar">
      <TextButton variant="primary" size="sm" iconLeft={<Plus size="sm" />} onClick={onCreateEvent} className="tl-toolbar__new-event">
        {t('timeline.newEvent')}
      </TextButton>

      <DropdownMenu
        align="left"
        trigger={
          <button type="button" className="tl-toolbar__button">
            {t('timeline.jumpToDate')}
            <ChevronDown size="xs" />
          </button>
        }
      >
        <DropdownItem label={t('timeline.jumpToStart')} onClick={onJumpStart} />
        <DropdownItem label={t('timeline.jumpToEnd')} onClick={onJumpEnd} />
        <DropdownDivider />
        <DropdownItem label={`${t('timeline.jumpToDate')}…`} onClick={onJumpToDate} />
      </DropdownMenu>

      <DropdownMenu
        align="left"
        onOpenChange={(open) => { if (!open) setTagSearch(''); }}
        trigger={
          <button
            type="button"
            className={`tl-toolbar__button ${activeTags.length > 0 ? 'tl-toolbar__button--active' : ''}`}
          >
            <Hash size="xs" />
            {activeTags.length > 0
              ? t('timeline.filter.buttonCount', { count: activeTags.length })
              : t('timeline.filter.button')}
          </button>
        }
      >
        {allTags.length === 0 ? (
          <div className="tl-toolbar__tag-empty">{t('timeline.filter.noTags')}</div>
        ) : (
          <>
            {allTags.length > TAG_SEARCH_THRESHOLD && (
              <div className="tl-toolbar__tag-search">
                <Search size="xs" />
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder={t('timeline.filter.searchTags')}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
            <div className="tl-toolbar__tag-list">
              {filteredTags.map((tag) => {
                const active = activeTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`tl-toolbar__tag-option ${active ? 'tl-toolbar__tag-option--active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); onToggleTag(tag); }}
                    role="menuitemcheckbox"
                    aria-checked={active}
                  >
                    <span className="tl-toolbar__tag-check">{active && <Check size="xs" />}</span>
                    {tag}
                  </button>
                );
              })}
            </div>
            {activeTags.length > 0 && (
              <>
                <DropdownDivider />
                <DropdownItem label={t('timeline.filter.clearAll')} onClick={onClearTags} />
              </>
            )}
          </>
        )}
      </DropdownMenu>

      <div className="tl-toolbar__chips">
        {activeTags.map((tag) => (
          <button key={tag} type="button" className="tl-toolbar__chip" onClick={() => onToggleTag(tag)} title={t('timeline.filter.clearAll')}>
            #{tag}
            <Close size="xs" />
          </button>
        ))}
        {hiddenTrackCount > 0 && (
          <button
            type="button"
            className="tl-toolbar__chip tl-toolbar__chip--warning"
            onClick={onShowAllTracks}
            title={t('timeline.showAll')}
          >
            ⊘ {t('timeline.hiddenTracks', { count: hiddenTrackCount })}
            <Close size="xs" />
          </button>
        )}
      </div>

      <span className="tl-toolbar__spacer" />

      <button type="button" className="tl-toolbar__button" onClick={onOpenCalendar}>
        <Timeline size="xs" />
        <span className="tl-toolbar__button-label">{t('timeline.calendarSettings')}</span>
      </button>
    </div>
  );
};

export default TimelineToolbar;

import React, { useState } from 'react';
import { DropdownMenu, DropdownItem, DropdownSection } from '../../../components/ui/DropdownMenu';
import { MoreHorizontal, Plus, Edit, Trash, ChevronRight } from '../../../components/icons';
import type { TimelineTrack } from '../../../types/timeline';
import type { TrackColorSet } from '../timelineColors';

interface TimelineTrackLabelProps {
  track: TimelineTrack;
  colors: TrackColorSet;
  depth: number;
  isExpanded: boolean;
  hasChildren: boolean;
  displayLanguage: string;
  onToggleExpand: () => void;
  onEditTrack: (track: TimelineTrack) => void;
  onAddSubTrack: (parentTrack: TimelineTrack) => void;
  onAddEvent: (track: TimelineTrack) => void;
  onDeleteTrack: (track: TimelineTrack) => void;
}

const TimelineTrackLabel: React.FC<TimelineTrackLabelProps> = ({
  track,
  colors,
  depth,
  isExpanded,
  hasChildren,
  displayLanguage,
  onToggleExpand,
  onEditTrack,
  onAddSubTrack,
  onAddEvent,
  onDeleteTrack,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const name = (track.data?.[displayLanguage] as Record<string, unknown>)?.name as string
    || (Object.values(track.data ?? {})[0] as Record<string, unknown>)?.name as string
    || 'Untitled Track';

  return (
    <div
      className={`timeline-track-label${menuOpen ? ' timeline-track-label--menu-open' : ''}`}
      style={{ paddingLeft: depth * 16 + 8 }}
    >
      <div className="timeline-track-label__color" style={{ background: colors.labelBar }} />

      {hasChildren ? (
        <button
          type="button"
          className={`timeline-track-label__chevron${isExpanded ? ' timeline-track-label__chevron--open' : ''}`}
          onClick={onToggleExpand}
        >
          <ChevronRight size="sm" />
        </button>
      ) : (
        <span className="timeline-track-label__chevron-spacer" />
      )}

      <span className="timeline-track-label__name" title={name}>{name}</span>

      <div className="timeline-track-label__actions">
        <DropdownMenu
          trigger={
            <button type="button" className="timeline-track-label__menu-btn">
              <MoreHorizontal size="sm" />
            </button>
          }
          align="left"
          onOpenChange={setMenuOpen}
        >
          <DropdownSection>
            <DropdownItem
              icon={<Edit size="sm" />}
              label="Edit Track"
              onClick={() => onEditTrack(track)}
            />
            <DropdownItem
              icon={<Plus size="sm" />}
              label="Add Sub-track"
              onClick={() => onAddSubTrack(track)}
            />
            {!hasChildren && (
              <DropdownItem
                icon={<Plus size="sm" />}
                label="Add Event"
                onClick={() => onAddEvent(track)}
              />
            )}
          </DropdownSection>
          <DropdownSection>
            <DropdownItem
              icon={<Trash size="sm" />}
              label="Delete Track"
              onClick={() => onDeleteTrack(track)}
              variant="danger"
            />
          </DropdownSection>
        </DropdownMenu>
      </div>
    </div>
  );
};

export default React.memo(TimelineTrackLabel);

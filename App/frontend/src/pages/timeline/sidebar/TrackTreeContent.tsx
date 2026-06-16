import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDndSensors } from '../../../hooks/useDndSensors';
import { DropdownMenu, DropdownItem, DropdownDivider } from '../../../components/ui/DropdownMenu';
import TextButton from '../../../components/TextButton/TextButton';
import { ChevronRight, Edit, Eye, GripVertical, MoreHorizontal, Plus, Trash } from '../../../components/icons';
import { confirm as confirmDialog } from '../../../store/dialogStore';
import { moveTrack, deleteTrack } from '../../../data/timeline';
import { useUiStore } from '../../../store/uiStore';
import type { TimelineTrack } from '../../../types/timeline';
import { resolveEntityText } from '../layout/computeTimelineLayout';
import { trackColorProps } from '../timelineColors';
import './TrackTreeContent.css';

const MAX_INDENT_LEVEL = 4;

export interface TrackTreeContentProps {
  projectId: string;
  tracks: TimelineTrack[];
  displayLanguage: string;
  visibleCount: number;
  totalCount: number;
  onEditTrack: (track: TimelineTrack) => void;
  onAddChild: (parentId: string | null) => void;
  onAddEvent: (trackId: string) => void;
  onMoveTrack: (track: TimelineTrack) => void;
  /** mobile drawer closes itself after actions that move focus to the stream */
  onAfterStreamAction?: () => void;
}

function countSubtree(track: TimelineTrack): { tracks: number; events: number } {
  let tracks = 0;
  let events = track.events?.length ?? 0;
  for (const child of track.children ?? []) {
    const sub = countSubtree(child);
    tracks += 1 + sub.tracks;
    events += sub.events;
  }
  return { tracks, events };
}

function subtreeHasExplicitHidden(track: TimelineTrack, hidden: ReadonlySet<string>): boolean {
  for (const child of track.children ?? []) {
    if (hidden.has(child.id) || subtreeHasExplicitHidden(child, hidden)) return true;
  }
  return false;
}

interface TrackRowProps {
  track: TimelineTrack;
  depth: number;
  ancestorHidden: boolean;
  hiddenSet: ReadonlySet<string>;
  expanded: boolean;
  displayLanguage: string;
  siblingCount: number;
  onToggleExpand: (trackId: string) => void;
  onToggleHidden: (trackId: string) => void;
  onEditTrack: (track: TimelineTrack) => void;
  onAddChild: (parentId: string | null) => void;
  onAddEvent: (trackId: string) => void;
  onMoveTrack: (track: TimelineTrack) => void;
  onNudge: (track: TimelineTrack, delta: -1 | 1) => void;
  onDelete: (track: TimelineTrack) => void;
}

const TrackRow: React.FC<TrackRowProps> = ({
  track,
  depth,
  ancestorHidden,
  hiddenSet,
  expanded,
  displayLanguage,
  siblingCount,
  onToggleExpand,
  onToggleHidden,
  onEditTrack,
  onAddChild,
  onAddEvent,
  onMoveTrack,
  onNudge,
  onDelete,
}) => {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.id,
    data: { parentId: track.parentId ?? null },
  });

  const { name } = resolveEntityText(track.data, displayLanguage);
  const displayName = name || t('timeline.tree.untitled');
  const hasChildren = (track.children?.length ?? 0) > 0;
  const isLeafWithEvents = !hasChildren && (track.events?.length ?? 0) > 0;
  const explicitHidden = hiddenSet.has(track.id);
  const isHidden = explicitHidden || ancestorHidden;
  const mixed = !isHidden && subtreeHasExplicitHidden(track, hiddenSet);
  const eventCount = hasChildren ? countSubtree(track).events : (track.events?.length ?? 0);

  return (
    <div
      ref={setNodeRef}
      className={[
        'tl-tree__row',
        isHidden && 'tl-tree__row--hidden',
        isDragging && 'tl-tree__row--dragging',
      ].filter(Boolean).join(' ')}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        '--tl-tree-depth': Math.min(depth, MAX_INDENT_LEVEL),
      } as React.CSSProperties}
    >
      {siblingCount > 1 ? (
        <span className="tl-tree__grip" {...attributes} {...listeners}>
          <GripVertical size="sm" />
        </span>
      ) : (
        <span className="tl-tree__grip tl-tree__grip--placeholder" />
      )}

      {hasChildren ? (
        <button
          type="button"
          className={`tl-tree__caret ${expanded ? 'tl-tree__caret--open' : ''}`}
          onClick={() => onToggleExpand(track.id)}
          aria-expanded={expanded}
          aria-label={displayName}
        >
          <ChevronRight size="sm" />
        </button>
      ) : (
        <span className="tl-tree__caret tl-tree__caret--placeholder" />
      )}

      <span
        className={`tl-tree__dot ${trackColorProps(track.color).className} ${isHidden ? 'tl-tree__dot--hidden' : ''}`}
        style={trackColorProps(track.color).style}
        aria-hidden="true"
      />

      <span className="tl-tree__name" title={displayName}>{displayName}</span>

      {eventCount > 0 && (
        <span className="tl-tree__count" title={t('timeline.tree.eventCount', { count: eventCount })}>
          {eventCount}
        </span>
      )}

      <button
        type="button"
        className={[
          'tl-tree__eye',
          explicitHidden && 'tl-tree__eye--off',
          mixed && 'tl-tree__eye--mixed',
        ].filter(Boolean).join(' ')}
        onClick={() => onToggleHidden(track.id)}
        disabled={ancestorHidden}
        aria-pressed={!explicitHidden}
        aria-label={t('timeline.tree.hide', { name: displayName })}
        title={ancestorHidden ? t('timeline.tree.hiddenByParent') : t('timeline.tree.hide', { name: displayName })}
      >
        <Eye size="sm" />
        {mixed && <span className="tl-tree__eye-mixed-dot" aria-hidden="true" />}
      </button>

      <DropdownMenu
        align="right"
        trigger={
          <button type="button" className="tl-tree__kebab" aria-label={displayName} title={displayName}>
            <MoreHorizontal size="sm" />
          </button>
        }
      >
        <DropdownItem icon={<Edit size="sm" />} label={t('timeline.tree.edit')} onClick={() => onEditTrack(track)} />
        <DropdownItem
          icon={<Plus size="sm" />}
          label={t('timeline.tree.addChild')}
          onClick={() => onAddChild(track.id)}
          disabled={isLeafWithEvents}
          className={isLeafWithEvents ? 'tl-tree__menu-disabled-hint' : ''}
        />
        {!hasChildren && (
          <DropdownItem icon={<Plus size="sm" />} label={t('timeline.tree.addEvent')} onClick={() => onAddEvent(track.id)} />
        )}
        <DropdownDivider />
        <DropdownItem label={t('timeline.tree.moveUp')} onClick={() => onNudge(track, -1)} />
        <DropdownItem label={t('timeline.tree.moveDown')} onClick={() => onNudge(track, 1)} />
        <DropdownItem label={t('timeline.tree.moveTo')} onClick={() => onMoveTrack(track)} />
        <DropdownDivider />
        <DropdownItem
          icon={<Trash size="sm" />}
          label={t('timeline.tree.delete')}
          variant="danger"
          onClick={() => onDelete(track)}
        />
      </DropdownMenu>
    </div>
  );
};

const TrackTreeContent: React.FC<TrackTreeContentProps> = ({
  projectId,
  tracks,
  displayLanguage,
  visibleCount,
  totalCount,
  onEditTrack,
  onAddChild,
  onAddEvent,
  onMoveTrack,
  onAfterStreamAction,
}) => {
  const { t } = useTranslation();
  const sensors = useDndSensors();
  const moveTrackAction = moveTrack;
  const deleteTrackAction = deleteTrack;
  const hiddenIds = useUiStore((s) => s.hiddenTrackIdsByProject[projectId]);
  const toggleTrackHidden = useUiStore((s) => s.toggleTrackHidden);
  const showAllTracks = useUiStore((s) => s.showAllTracks);
  const hiddenSet = useMemo(() => new Set(hiddenIds ?? []), [hiddenIds]);

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => new Set());
  const [initializedExpand, setInitializedExpand] = useState(false);

  // expand every parent on first load
  useEffect(() => {
    if (initializedExpand || tracks.length === 0) return;
    const all = new Set<string>();
    const walk = (list: TimelineTrack[]) => {
      for (const track of list) {
        if ((track.children?.length ?? 0) > 0) {
          all.add(track.id);
          walk(track.children);
        }
      }
    };
    walk(tracks);
    setExpandedNodes(all);
    setInitializedExpand(true);
  }, [tracks, initializedExpand]);

  const handleToggleExpand = useCallback((trackId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  }, []);

  const handleToggleHidden = useCallback((trackId: string) => {
    toggleTrackHidden(projectId, trackId);
  }, [toggleTrackHidden, projectId]);

  const handleNudge = useCallback(async (track: TimelineTrack, delta: -1 | 1) => {
    const position = Math.max(track.position + delta, 0);
    if (position === track.position) return;
    await moveTrackAction(projectId, track.id, { parentId: track.parentId ?? null, position }, displayLanguage);
  }, [moveTrackAction, projectId, displayLanguage]);

  const handleDelete = useCallback(async (track: TimelineTrack) => {
    const { name } = resolveEntityText(track.data, displayLanguage);
    const counts = countSubtree(track);
    const ok = await confirmDialog({
      title: t('timeline.tree.deleteConfirmTitle'),
      message: t('timeline.tree.deleteConfirmBody', {
        name: name || t('timeline.tree.untitled'),
        children: counts.tracks,
        events: counts.events,
      }),
      variant: 'danger',
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    await deleteTrackAction(projectId, track.id, displayLanguage);
  }, [deleteTrackAction, displayLanguage, projectId, t]);

  const handleAddEvent = useCallback((trackId: string) => {
    onAddEvent(trackId);
    onAfterStreamAction?.();
  }, [onAddEvent, onAfterStreamAction]);

  const handleDragEnd = useCallback((event: DragEndEvent, siblings: TimelineTrack[]) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeData = active.data.current as { parentId: string | null } | undefined;
    const overData = over.data.current as { parentId: string | null } | undefined;
    // same-parent reordering only — re-parenting goes through “Move to…”
    if (!activeData || !overData || activeData.parentId !== overData.parentId) return;
    const newIndex = siblings.findIndex((track) => track.id === over.id);
    if (newIndex === -1) return;
    void moveTrackAction(
      projectId,
      String(active.id),
      { parentId: activeData.parentId, position: newIndex },
      displayLanguage,
    );
  }, [moveTrackAction, projectId, displayLanguage]);

  const renderLevel = (siblings: TimelineTrack[], depth: number, ancestorHidden: boolean): React.ReactNode => (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => handleDragEnd(event, siblings)}
    >
      <SortableContext items={siblings.map((track) => track.id)} strategy={verticalListSortingStrategy}>
        {siblings.map((track) => {
          const isHidden = ancestorHidden || hiddenSet.has(track.id);
          const expanded = expandedNodes.has(track.id);
          return (
            <React.Fragment key={track.id}>
              <TrackRow
                track={track}
                depth={depth}
                ancestorHidden={ancestorHidden}
                hiddenSet={hiddenSet}
                expanded={expanded}
                displayLanguage={displayLanguage}
                siblingCount={siblings.length}
                onToggleExpand={handleToggleExpand}
                onToggleHidden={handleToggleHidden}
                onEditTrack={onEditTrack}
                onAddChild={onAddChild}
                onAddEvent={handleAddEvent}
                onMoveTrack={onMoveTrack}
                onNudge={handleNudge}
                onDelete={handleDelete}
              />
              {expanded && (track.children?.length ?? 0) > 0 && (
                renderLevel(track.children, depth + 1, isHidden)
              )}
            </React.Fragment>
          );
        })}
      </SortableContext>
    </DndContext>
  );

  return (
    <div className="tl-tree">
      <div className="tl-tree__header">
        <div className="tl-tree__header-text">
          <span className="tl-tree__title">{t('timeline.tree.title')}</span>
          <span className="tl-tree__subtitle">{t('timeline.tree.subtitle')}</span>
        </div>
        <TextButton variant="ghost" size="sm" iconLeft={<Plus size="sm" />} onClick={() => onAddChild(null)}>
          {t('timeline.newTrack')}
        </TextButton>
      </div>

      <div className="tl-tree__rows">
        {renderLevel(tracks, 0, false)}
      </div>

      <div className="tl-tree__footer">
        <span className="tl-tree__summary">
          {t('timeline.tree.visibleSummary', { visible: visibleCount, total: totalCount })}
        </span>
        {hiddenSet.size > 0 && (
          <button type="button" className="tl-tree__show-all" onClick={() => showAllTracks(projectId)}>
            {t('timeline.showAll')}
          </button>
        )}
      </div>
    </div>
  );
};

export default TrackTreeContent;

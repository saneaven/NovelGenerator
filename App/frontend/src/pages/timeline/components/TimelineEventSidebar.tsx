import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Close, Plus, Trash } from '../../../components/icons';
import { RichTextEditor } from '../../../components/RichTextEditor';
import { emptyDoc, normalizeDoc } from '../../../editor/manuscript/doc';
import { NumberInput } from '../../../components/ui/NumberInput';
import { StringChipInput } from '../../../components/ui/StringChipInput';
import ObjectPicker from '../../../components/ObjectPicker/ObjectPicker';
import { useObjectPickerData } from '../../../components/ObjectPicker/useObjectPickerData';
import type { ObjectPickerGroup, ObjectPickerItem } from '../../../components/ObjectPicker/types';
import { useTimelineStore } from '../../../store/timelineStore';
import type { TipTapDoc } from '../../../types/tiptap';
import type {
  CalendarConfig,
  TimelineDate,
  TimelineEvent,
  TimelineEventLinkRequest,
  TimelineTrack,
} from '../../../types/timeline';
import { getAnyObjectTypeLabel } from '../../../types/timeline';
import type { AnyObjectType } from '../../../types/unifiedObject';
import { clampTimelineDate, dateUnitMax } from '../../../utils/timelineCalendar';
import './TimelineEventSidebar.css';

interface TimelineEventSidebarProps {
  projectId: string;
  event: TimelineEvent | null;
  createForTrack: { track: TimelineTrack; date: TimelineDate } | null;
  displayLanguage: string;
  calendar: CalendarConfig;
  tracks: TimelineTrack[];
  onClose: () => void;
}

/** Collect all leaf tracks (only leaves can hold events). */
function collectLeafTracks(tracks: TimelineTrack[], lang: string): { id: string; name: string }[] {
  const result: { id: string; name: string }[] = [];
  for (const t of tracks) {
    if (t.children.length > 0) {
      result.push(...collectLeafTracks(t.children, lang));
    } else {
      const name = (t.data?.[lang] as Record<string, unknown>)?.name as string
        || (Object.values(t.data ?? {})[0] as Record<string, unknown>)?.name as string
        || 'Untitled';
      result.push({ id: t.id, name });
    }
  }
  return result;
}

const LINKABLE_TYPES = new Set<string>(['story_entity', 'outline']);

function filterLinkGroups(groups: ObjectPickerGroup[]): ObjectPickerGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => LINKABLE_TYPES.has(item.type)),
      childGroups: group.childGroups ? filterLinkGroups(group.childGroups) : undefined,
    }))
    .filter((group) => group.items.length > 0 || (group.childGroups?.length ?? 0) > 0);
}

function collectLinkItems(groups: ObjectPickerGroup[]): Map<string, ObjectPickerItem> {
  const items = new Map<string, ObjectPickerItem>();
  const walk = (list: ObjectPickerGroup[]) => {
    for (const group of list) {
      for (const item of group.items) {
        items.set(item.id, item);
      }
      if (group.childGroups) {
        walk(group.childGroups);
      }
    }
  };
  walk(groups);
  return items;
}

const TimelineEventSidebar: React.FC<TimelineEventSidebarProps> = ({
  projectId,
  event,
  createForTrack,
  displayLanguage,
  calendar,
  tracks,
  onClose,
}) => {
  const createEventAction = useTimelineStore((s) => s.createEvent);
  const updateEventAction = useTimelineStore((s) => s.updateEvent);
  const deleteEventAction = useTimelineStore((s) => s.deleteEvent);
  const createEventLinkAction = useTimelineStore((s) => s.createEventLink);
  const deleteEventLinkAction = useTimelineStore((s) => s.deleteEventLink);
  const { groups: objectPickerGroups } = useObjectPickerData({
    projectId,
    language: displayLanguage,
    mode: 'all',
  });

  const isCreating = event === null;
  const linkGroups = useMemo(() => filterLinkGroups(objectPickerGroups), [objectPickerGroups]);
  const linkItems = useMemo(() => collectLinkItems(linkGroups), [linkGroups]);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState<TipTapDoc>(emptyDoc());
  const [startDate, setStartDate] = useState<TimelineDate>({});
  const [endDate, setEndDate] = useState<TimelineDate | null>(null);
  const [hasEndDate, setHasEndDate] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [trackId, setTrackId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [draftLinks, setDraftLinks] = useState<TimelineEventLinkRequest[]>([]);
  const [showLinkPicker, setShowLinkPicker] = useState(false);

  // Initialize form
  useEffect(() => {
    if (event) {
      const data = (event.data?.[displayLanguage] ?? Object.values(event.data ?? {})[0] ?? {}) as Record<string, unknown>;
      setName((data.name as string) || '');
      setDescription((data.description as string) || '');
      setContent(normalizeDoc(data.content));
      setStartDate(clampTimelineDate({ ...event.startDate }, calendar));
      setEndDate(event.endDate ? clampTimelineDate({ ...event.endDate }, calendar) : null);
      setHasEndDate(!!event.endDate);
      setTags([...event.tags]);
      setTrackId(event.trackId);
      setDraftLinks([]);
      setShowLinkPicker(false);
    } else if (createForTrack) {
      setName('');
      setDescription('');
      setContent(emptyDoc());
      setStartDate(clampTimelineDate({ ...createForTrack.date }, calendar));
      setEndDate(null);
      setHasEndDate(false);
      setTags([]);
      setTrackId(createForTrack.track.id);
      setDraftLinks([]);
      setShowLinkPicker(false);
    }
  }, [event, createForTrack, displayLanguage, calendar]);

  const leafTracks = collectLeafTracks(tracks, displayLanguage);

  const updateDateUnit = useCallback((target: 'start' | 'end', unitName: string, value: number | undefined) => {
    if (target === 'start') {
      setStartDate((prev) => clampTimelineDate({ ...prev, [unitName]: value ?? 1 }, calendar));
      return;
    }
    setEndDate((prev) => {
      if (!prev) return prev;
      return clampTimelineDate({ ...prev, [unitName]: value ?? 1 }, calendar);
    });
  }, [calendar]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      if (isCreating) {
        await createEventAction(projectId, {
          trackId,
          language: displayLanguage,
          name: name.trim(),
          description: description.trim(),
          content,
          startDate,
          endDate: hasEndDate ? endDate : null,
          tags,
          links: draftLinks,
        }, displayLanguage);
        // After creation, the store refetches. We close create mode.
        onClose();
      } else if (event) {
        await updateEventAction(projectId, event.id, {
          trackId,
          language: displayLanguage,
          name: name.trim(),
          description: description.trim(),
          content,
          startDate,
          endDate: hasEndDate ? endDate : null,
          tags,
        }, displayLanguage);
      }
    } finally {
      setIsSaving(false);
    }
  }, [isCreating, name, description, content, startDate, endDate, hasEndDate, tags, draftLinks, trackId, projectId, displayLanguage, event, createEventAction, updateEventAction, onClose]);

  const handlePickLink = useCallback(
    async (ids: string[] | string) => {
      const objectId = Array.isArray(ids) ? ids[0] : ids;
      if (!objectId) return;
      const target = linkItems.get(objectId);
      if (!target || !LINKABLE_TYPES.has(target.type)) return;

      setShowLinkPicker(false);
      if (isCreating) {
        setDraftLinks((prev) => {
          if (prev.some((link) => link.objectType === target.type && link.objectId === objectId)) {
            return prev;
          }
          return [...prev, { objectType: target.type, objectId }];
        });
        return;
      }

      if (!event) return;
      await createEventLinkAction(
        projectId,
        event.id,
        { objectType: target.type, objectId },
        displayLanguage,
      );
    },
    [isCreating, event, linkItems, projectId, displayLanguage, createEventLinkAction],
  );

  const handleRemoveDraftLink = useCallback((link: TimelineEventLinkRequest) => {
    setDraftLinks((prev) => prev.filter((entry) => entry.objectType !== link.objectType || entry.objectId !== link.objectId));
  }, []);

  const handleDelete = useCallback(async () => {
    if (!event) return;
    if (!confirm('Delete this event?')) return;
    await deleteEventAction(projectId, event.id, displayLanguage);
    onClose();
  }, [event, projectId, displayLanguage, deleteEventAction, onClose]);

  const handleToggleEndDate = useCallback(() => {
    setHasEndDate((prev) => {
      if (!prev) {
        // Initialize end date from start date
        setEndDate({ ...startDate });
      } else {
        setEndDate(null);
      }
      return !prev;
    });
  }, [startDate]);

  return (
    <div className="timeline-event-sidebar">
      <div className="timeline-event-sidebar__header">
        <h3 className="timeline-event-sidebar__title">
          {isCreating ? 'New Event' : 'Edit Event'}
        </h3>
        <div className="timeline-event-sidebar__header-actions">
          {!isCreating && (
            <button type="button" className="timeline-event-sidebar__icon-btn" onClick={handleDelete} title="Delete">
              <Trash size="sm" />
            </button>
          )}
          <button type="button" className="timeline-event-sidebar__icon-btn" onClick={onClose}>
            <Close size="sm" />
          </button>
        </div>
      </div>

      <div className="timeline-event-sidebar__body">
        {/* Name */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">Name</label>
          <input
            type="text"
            className="timeline-event-sidebar__input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Event name"
            autoFocus={isCreating}
          />
        </div>

        {/* Track */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">Track</label>
          <select
            className="timeline-event-sidebar__select"
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
          >
            {leafTracks.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>

        {/* Start Date */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">Start Date</label>
          <div className="timeline-event-sidebar__date-row">
            {calendar.units.map((unit) => (
              <div key={unit.name} className="timeline-event-sidebar__date-unit">
                <span className="timeline-event-sidebar__date-unit-label">{unit.label}</span>
                <NumberInput
                  className="timeline-event-sidebar__date-input"
                  value={startDate[unit.name] ?? 1}
                  onValueChange={(v) => updateDateUnit('start', unit.name, v)}
                  min={1}
                  max={dateUnitMax(calendar, startDate, unit.name)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* End Date toggle + fields */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">
            <input
              type="checkbox"
              checked={hasEndDate}
              onChange={handleToggleEndDate}
            />
            {' '}End Date (range event)
          </label>
          {hasEndDate && endDate && (
            <div className="timeline-event-sidebar__date-row">
              {calendar.units.map((unit) => (
                <div key={unit.name} className="timeline-event-sidebar__date-unit">
                  <span className="timeline-event-sidebar__date-unit-label">{unit.label}</span>
                  <NumberInput
                    className="timeline-event-sidebar__date-input"
                    value={endDate[unit.name] ?? 1}
                    onValueChange={(v) => updateDateUnit('end', unit.name, v)}
                    min={1}
                    max={dateUnitMax(calendar, endDate, unit.name)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Description */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">Description</label>
          <textarea
            className="timeline-event-sidebar__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe this event..."
            rows={4}
          />
        </div>

        {/* Content */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">Content</label>
          <RichTextEditor
            initialContent={content}
            onChange={setContent}
            placeholder="Write detailed content..."
          />
        </div>

        {/* Tags */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">Tags</label>
          <StringChipInput
            values={tags}
            onChange={setTags}
            placeholder="Add tags..."
            ariaLabel="Event tags"
          />
        </div>

        {/* Links */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">Links</label>
          <div className="timeline-event-sidebar__links">
            {isCreating ? (
              draftLinks.map((link) => (
                <span key={`${link.objectType}:${link.objectId}`} className="timeline-event-sidebar__link-chip">
                  <span className="timeline-event-sidebar__link-type">
                    {getAnyObjectTypeLabel(link.objectType as AnyObjectType)}
                  </span>
                  <span className="timeline-event-sidebar__link-name">
                    {linkItems.get(link.objectId)?.name ?? 'Unknown'}
                  </span>
                  <button
                    type="button"
                    className="timeline-event-sidebar__link-remove"
                    onClick={() => handleRemoveDraftLink(link)}
                    title="Remove link"
                  >
                    <Close size="xs" />
                  </button>
                </span>
              ))
            ) : (
              event?.links.map((link) => (
                <span key={link.id} className="timeline-event-sidebar__link-chip">
                  <span className="timeline-event-sidebar__link-type">
                    {getAnyObjectTypeLabel(link.objectType as AnyObjectType)}
                  </span>
                  <span className="timeline-event-sidebar__link-name">
                    {linkItems.get(link.objectId)?.name ?? 'Unknown'}
                  </span>
                  <button
                    type="button"
                    className="timeline-event-sidebar__link-remove"
                    onClick={() => {
                      void deleteEventLinkAction(projectId, link.eventId, link.id, displayLanguage);
                    }}
                    title="Remove link"
                  >
                    <Close size="xs" />
                  </button>
                </span>
              ))
            )}
            <button
              type="button"
              className="timeline-event-sidebar__link-add"
              onClick={() => setShowLinkPicker((prev) => !prev)}
            >
              <Plus size="xs" />
              Add link
            </button>
          </div>
          {showLinkPicker && (
            <div className="timeline-event-sidebar__link-picker">
              <ObjectPicker
                mode="all"
                selectionMode="single"
                selectedIds=""
                onChange={(ids) => {
                  void handlePickLink(ids);
                }}
                projectId={projectId}
                language={displayLanguage}
                customGroups={linkGroups}
                showPreview={false}
                maxHeight={240}
              />
            </div>
          )}
        </div>
      </div>

      <div className="timeline-event-sidebar__footer">
        <button
          type="button"
          className="timeline-event-sidebar__btn timeline-event-sidebar__btn--secondary"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="timeline-event-sidebar__btn timeline-event-sidebar__btn--primary"
          onClick={handleSave}
          disabled={isSaving || !name.trim()}
        >
          {isCreating ? 'Create' : 'Save'}
        </button>
      </div>
    </div>
  );
};

export default TimelineEventSidebar;

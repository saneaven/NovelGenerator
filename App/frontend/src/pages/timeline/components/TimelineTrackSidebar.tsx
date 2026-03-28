import React, { useCallback, useEffect, useState } from 'react';
import { Close } from '../../../components/icons';
import { RichTextEditor } from '../../../components/RichTextEditor';
import { emptyDoc, normalizeDoc } from '../../../editor/manuscript/doc';
import { useTimelineStore } from '../../../store/timelineStore';
import type { TipTapDoc } from '../../../types/tiptap';
import type { CalendarConfig, TimelineTrack } from '../../../types/timeline';
import { PRESET_NAMES, presetSwatch } from '../timelineColors';

interface TimelineTrackSidebarProps {
  projectId: string;
  track: TimelineTrack | null;
  parentId: string | null;
  displayLanguage: string;
  calendar: CalendarConfig;
  onClose: () => void;
}

const TimelineTrackSidebar: React.FC<TimelineTrackSidebarProps> = ({
  projectId,
  track,
  parentId,
  displayLanguage,
  calendar,
  onClose,
}) => {
  const createTrack = useTimelineStore((s) => s.createTrack);
  const updateTrack = useTimelineStore((s) => s.updateTrack);

  const isCreating = track === null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState<TipTapDoc>(emptyDoc());
  const [color, setColor] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (track) {
      const data = (track.data?.[displayLanguage] ?? Object.values(track.data ?? {})[0] ?? {}) as Record<string, unknown>;
      setName((data.name as string) || '');
      setDescription((data.description as string) || '');
      setContent(normalizeDoc(data.content));
      setColor(track.color || null);
    } else {
      setName('');
      setDescription('');
      setContent(emptyDoc());
      setColor(null);
    }
  }, [track, displayLanguage]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      if (isCreating) {
        await createTrack(projectId, {
          language: displayLanguage,
          name: name.trim(),
          description: description.trim(),
          content,
          parentId: parentId,
          color,
        }, displayLanguage);
      } else if (track) {
        await updateTrack(projectId, track.id, {
          language: displayLanguage,
          name: name.trim(),
          description: description.trim(),
          content,
          color,
        }, displayLanguage);
      }
      onClose();
    } finally {
      setIsSaving(false);
    }
  }, [isCreating, name, description, content, color, parentId, projectId, displayLanguage, track, createTrack, updateTrack, onClose]);

  return (
    <div className="timeline-track-sidebar">
      <div className="timeline-event-sidebar__header">
        <h3 className="timeline-event-sidebar__title">
          {isCreating ? 'New Track' : 'Edit Track'}
        </h3>
        <button type="button" className="timeline-event-sidebar__icon-btn" onClick={onClose}>
          <Close size="sm" />
        </button>
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
            placeholder="Track name"
            autoFocus={isCreating}
          />
        </div>

        {/* Color */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">Color</label>
          <div className="timeline-track-sidebar__colors">
            <button
              type="button"
              className={`timeline-track-sidebar__swatch${color === null ? ' timeline-track-sidebar__swatch--active' : ''}`}
              style={{ background: 'var(--color-brand-primary-outline)' }}
              onClick={() => setColor(null)}
              title="Default"
            />
            {PRESET_NAMES.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`timeline-track-sidebar__swatch${color === preset ? ' timeline-track-sidebar__swatch--active' : ''}`}
                style={{ background: presetSwatch(preset) }}
                onClick={() => setColor(preset)}
                title={preset}
              />
            ))}
          </div>
        </div>

        {/* Description */}
        <div className="timeline-event-sidebar__field">
          <label className="timeline-event-sidebar__label">Description</label>
          <textarea
            className="timeline-event-sidebar__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Track description..."
            rows={3}
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

export default TimelineTrackSidebar;

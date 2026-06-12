import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BaseModal from '../../../components/BaseModal/BaseModal';
import TextButton from '../../../components/TextButton/TextButton';
import FormDisclosure from './FormDisclosure';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { StringChipInput } from '../../../components/ui/StringChipInput';
import ToggleSwitch from '../../../components/common/ToggleSwitch';
import ObjectPicker from '../../../components/ObjectPicker/ObjectPicker';
import type { ObjectPickerGroup, ObjectPickerItem } from '../../../components/ObjectPicker/types';
import { RichTextEditor } from '../../../components/RichTextEditor';
import { Close, Plus, Trash } from '../../../components/icons';
import { emptyDoc, normalizeDoc } from '../../../editor/manuscript/doc';
import { confirm as confirmDialog } from '../../../store/dialogStore';
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
import {
  clampTimelineDate,
  compareTimelineDates,
  validateDate,
} from '../../../utils/timelineCalendar';
import { resolveEntityText } from '../layout/computeTimelineLayout';
import { trackColorProps } from '../timelineColors';
import { LINKABLE_TYPES } from './eventLinkUtils';
import DateFieldsInput from './DateFieldsInput';
import './TimelineModals.css';

export interface EventCreateDefaults {
  trackId?: string;
  startDate?: TimelineDate;
}

interface EventEditModalProps {
  projectId: string;
  calendar: CalendarConfig;
  tracks: TimelineTrack[];
  displayLanguage: string;
  /** null = create mode */
  event: TimelineEvent | null;
  defaults: EventCreateDefaults | null;
  linkGroups: ObjectPickerGroup[];
  linkItems: ReadonlyMap<string, ObjectPickerItem>;
  onClose: () => void;
  onCreated?: (event: TimelineEvent) => void;
}

interface LeafTrackOption {
  id: string;
  name: string;
  path: string;
  color: string | null;
}

function collectLeafTracks(tracks: TimelineTrack[], lang: string, parents: string[] = [], inheritedColor: string | null = null): LeafTrackOption[] {
  const result: LeafTrackOption[] = [];
  for (const track of tracks) {
    const { name } = resolveEntityText(track.data, lang);
    const displayName = name || 'Untitled';
    const effectiveColor = track.color ?? inheritedColor;
    if ((track.children?.length ?? 0) > 0) {
      result.push(...collectLeafTracks(track.children, lang, [...parents, displayName], effectiveColor));
    } else {
      result.push({
        id: track.id,
        name: displayName,
        path: [...parents, displayName].join(' › '),
        color: effectiveColor,
      });
    }
  }
  return result;
}

const defaultDate = (calendar: CalendarConfig): TimelineDate => {
  const date: TimelineDate = {};
  for (const unit of calendar.units) date[unit.name] = 1;
  return date;
};

const EventEditModal: React.FC<EventEditModalProps> = ({
  projectId,
  calendar,
  tracks,
  displayLanguage,
  event,
  defaults,
  linkGroups,
  linkItems,
  onClose,
  onCreated,
}) => {
  const { t } = useTranslation();
  const createEvent = useTimelineStore((s) => s.createEvent);
  const updateEvent = useTimelineStore((s) => s.updateEvent);
  const deleteEvent = useTimelineStore((s) => s.deleteEvent);
  const createEventLink = useTimelineStore((s) => s.createEventLink);
  const deleteEventLink = useTimelineStore((s) => s.deleteEventLink);

  const isCreating = event === null;
  const leafTracks = useMemo(() => collectLeafTracks(tracks, displayLanguage), [tracks, displayLanguage]);

  const initial = useMemo(() => {
    if (event) {
      const data = (event.data?.[displayLanguage] ?? Object.values(event.data ?? {})[0] ?? {}) as Record<string, unknown>;
      return {
        name: (data.name as string) || '',
        description: (data.description as string) || '',
        content: normalizeDoc(data.content),
        startDate: clampTimelineDate({ ...event.startDate }, calendar),
        endDate: event.endDate ? clampTimelineDate({ ...event.endDate }, calendar) : null,
        tags: [...event.tags],
        trackId: event.trackId,
      };
    }
    return {
      name: '',
      description: '',
      content: emptyDoc(),
      startDate: clampTimelineDate({ ...(defaults?.startDate ?? defaultDate(calendar)) }, calendar),
      endDate: null,
      tags: [] as string[],
      trackId: defaults?.trackId ?? (leafTracks.length === 1 ? leafTracks[0].id : ''),
    };
  }, [event, defaults, displayLanguage, calendar, leafTracks]);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [content, setContent] = useState<TipTapDoc>(initial.content);
  const [startDate, setStartDate] = useState<TimelineDate>(initial.startDate);
  const [endDate, setEndDate] = useState<TimelineDate | null>(initial.endDate);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [trackId, setTrackId] = useState(initial.trackId);
  const [draftLinks, setDraftLinks] = useState<TimelineEventLinkRequest[]>([]);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [pendingLinkIds, setPendingLinkIds] = useState<Set<string>>(() => new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement | null>(null);

  const isDirty = name !== initial.name
    || description !== initial.description
    || trackId !== initial.trackId
    || JSON.stringify(startDate) !== JSON.stringify(initial.startDate)
    || JSON.stringify(endDate) !== JSON.stringify(initial.endDate)
    || JSON.stringify(tags) !== JSON.stringify(initial.tags)
    || draftLinks.length > 0
    || JSON.stringify(content) !== JSON.stringify(initial.content);

  const handleClose = useCallback(async () => {
    if (isDirty) {
      const ok = await confirmDialog({
        title: t('timeline.eventModal.discardTitle'),
        message: t('timeline.eventModal.discardBody'),
        variant: 'warning',
        confirmLabel: t('common.confirm'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
    }
    onClose();
  }, [isDirty, onClose, t]);

  const validate = useCallback((): Record<string, string> => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t('timeline.eventModal.errors.nameRequired');
    if (!trackId || !leafTracks.some((track) => track.id === trackId)) {
      next.track = t('timeline.eventModal.errors.trackRequired');
    }
    if (!validateDate(startDate, calendar)) next.startDate = t('timeline.eventModal.errors.invalidDate');
    if (endDate !== null) {
      if (!validateDate(endDate, calendar)) next.endDate = t('timeline.eventModal.errors.invalidDate');
      else if (validateDate(startDate, calendar) && compareTimelineDates(endDate, startDate, calendar) < 0) {
        next.endDate = t('timeline.eventModal.errors.endBeforeStart');
      }
    }
    return next;
  }, [name, trackId, leafTracks, startDate, endDate, calendar, t]);

  const handleSave = useCallback(async () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      if (nextErrors.name) nameRef.current?.focus();
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      if (isCreating) {
        const created = await createEvent(projectId, {
          trackId,
          language: displayLanguage,
          name: name.trim(),
          description: description.trim(),
          content,
          startDate,
          endDate,
          tags,
          links: draftLinks,
        }, displayLanguage);
        onClose();
        onCreated?.(created);
      } else if (event) {
        await updateEvent(projectId, event.id, {
          trackId,
          language: displayLanguage,
          name: name.trim(),
          description: description.trim(),
          content,
          startDate,
          endDate,
          tags,
        }, displayLanguage);
        onClose();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [validate, isCreating, event, createEvent, updateEvent, projectId, trackId, displayLanguage, name, description, content, startDate, endDate, tags, draftLinks, onClose, onCreated]);

  const handleDelete = useCallback(async () => {
    if (!event) return;
    const ok = await confirmDialog({
      title: t('timeline.eventModal.deleteConfirmTitle'),
      message: t('timeline.eventModal.deleteConfirmBody', { name: name || t('timeline.card.untitled') }),
      variant: 'danger',
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    await deleteEvent(projectId, event.id, displayLanguage);
    onClose();
  }, [event, name, deleteEvent, projectId, displayLanguage, onClose, t]);

  const handleToggleEndDate = useCallback((checked: boolean) => {
    setEndDate(checked ? { ...startDate } : null);
    setErrors((prev) => {
      const { endDate: _removed, ...rest } = prev;
      return rest;
    });
  }, [startDate]);

  const handlePickLink = useCallback(async (ids: string[] | string) => {
    const objectId = Array.isArray(ids) ? ids[0] : ids;
    if (!objectId) return;
    const target = linkItems.get(objectId);
    if (!target || !LINKABLE_TYPES.has(target.type)) return;
    setShowLinkPicker(false);

    if (isCreating) {
      setDraftLinks((prev) => (
        prev.some((link) => link.objectType === target.type && link.objectId === objectId)
          ? prev
          : [...prev, { objectType: target.type, objectId }]
      ));
      return;
    }
    if (!event) return;
    setPendingLinkIds((prev) => new Set(prev).add(objectId));
    try {
      await createEventLink(projectId, event.id, { objectType: target.type, objectId }, displayLanguage);
    } finally {
      setPendingLinkIds((prev) => {
        const next = new Set(prev);
        next.delete(objectId);
        return next;
      });
    }
  }, [linkItems, isCreating, event, createEventLink, projectId, displayLanguage]);

  const handleRemoveLink = useCallback(async (linkId: string, objectId: string) => {
    if (!event) return;
    setPendingLinkIds((prev) => new Set(prev).add(objectId));
    try {
      await deleteEventLink(projectId, event.id, linkId, displayLanguage);
    } finally {
      setPendingLinkIds((prev) => {
        const next = new Set(prev);
        next.delete(objectId);
        return next;
      });
    }
  }, [event, deleteEventLink, projectId, displayLanguage]);

  const trackOptions = useMemo(() => leafTracks.map((track) => ({
    value: track.id,
    label: track.path,
  })), [leafTracks]);

  return (
    <BaseModal
      isOpen
      onClose={handleClose}
      title={isCreating ? t('timeline.eventModal.createTitle') : t('timeline.eventModal.editTitle')}
      size="large"
      className="tl-event-modal"
      footer={
        <div className="tl-modal-footer tl-modal-footer--split">
          <div>
            {!isCreating && (
              <TextButton variant="danger" iconLeft={<Trash size="sm" />} onClick={handleDelete}>
                {t('timeline.eventModal.deleteEvent')}
              </TextButton>
            )}
          </div>
          <div className="tl-modal-footer">
            <TextButton variant="secondary" onClick={handleClose}>{t('common.cancel')}</TextButton>
            <TextButton variant="primary" onClick={handleSave} loading={isSaving}>
              {isCreating ? t('common.create') : t('common.save')}
            </TextButton>
          </div>
        </div>
      }
    >
      <div className="tl-form">
        {saveError && (
          <div className="tl-form__error-banner" role="alert">
            {t('timeline.eventModal.errors.saveFailed', { message: saveError })}
          </div>
        )}

        <div className="tl-form__field">
          <label className="tl-form__label" htmlFor="tl-event-name">{t('timeline.eventModal.name')}</label>
          <input
            id="tl-event-name"
            ref={nameRef}
            type="text"
            className={`tl-form__input ${errors.name ? 'tl-form__input--invalid' : ''}`}
            value={name}
            onChange={(e) => { setName(e.target.value); setErrors((prev) => ({ ...prev, name: '' })); }}
            placeholder={t('timeline.eventModal.namePlaceholder')}
            autoFocus={isCreating}
          />
          {errors.name && <span className="tl-form__field-error" role="alert">{errors.name}</span>}
        </div>

        <div className="tl-form__field">
          <span className="tl-form__label">{t('timeline.eventModal.track')}</span>
          <CustomSelect
            value={trackId}
            onChange={(value) => { setTrackId(value); setErrors((prev) => ({ ...prev, track: '' })); }}
            options={trackOptions}
            placeholder={t('timeline.eventModal.trackPlaceholder')}
            renderOption={({ option, isSelected, onSelect }) => {
              const leaf = leafTracks.find((track) => track.id === option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`tl-form__track-option ${isSelected ? 'tl-form__track-option--selected' : ''}`}
                  onClick={onSelect}
                >
                  <span
                    className={`tl-tree__dot ${trackColorProps(leaf?.color ?? null).className}`}
                    style={trackColorProps(leaf?.color ?? null).style}
                    aria-hidden="true"
                  />
                  <span className="tl-form__track-option-label">{option.label}</span>
                </button>
              );
            }}
          />
          {errors.track && <span className="tl-form__field-error" role="alert">{errors.track}</span>}
        </div>

        <div className="tl-form__field">
          <span className="tl-form__label">{t('timeline.eventModal.startDate')}</span>
          <DateFieldsInput
            calendar={calendar}
            value={startDate}
            onChange={(next) => { setStartDate(next); setErrors((prev) => ({ ...prev, startDate: '', endDate: '' })); }}
            idPrefix="tl-event-start"
            invalid={!!errors.startDate}
          />
          {errors.startDate && <span className="tl-form__field-error" role="alert">{errors.startDate}</span>}
        </div>

        <div className="tl-form__field">
          <ToggleSwitch
            checked={endDate !== null}
            onChange={handleToggleEndDate}
            label={t('timeline.eventModal.hasEndDate')}
          />
          {endDate !== null && (
            <>
              <DateFieldsInput
                calendar={calendar}
                value={endDate}
                onChange={(next) => { setEndDate(next); setErrors((prev) => ({ ...prev, endDate: '' })); }}
                idPrefix="tl-event-end"
                invalid={!!errors.endDate}
              />
              {errors.endDate && <span className="tl-form__field-error" role="alert">{errors.endDate}</span>}
            </>
          )}
        </div>

        <div className="tl-form__field">
          <span className="tl-form__label">{t('timeline.eventModal.tags')}</span>
          <StringChipInput
            values={tags}
            onChange={setTags}
            placeholder={t('timeline.eventModal.tags')}
            ariaLabel={t('timeline.eventModal.tags')}
          />
        </div>

        <div className="tl-form__field">
          <label className="tl-form__label" htmlFor="tl-event-desc">{t('timeline.eventModal.description')}</label>
          <textarea
            id="tl-event-desc"
            className="tl-form__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('timeline.eventModal.descriptionPlaceholder')}
            rows={3}
          />
        </div>

        <FormDisclosure label={t('timeline.eventModal.content')}>
          <RichTextEditor initialContent={content} onChange={setContent} />
        </FormDisclosure>

        <div className="tl-form__field">
          <span className="tl-form__label">{t('timeline.eventModal.links')}</span>
          <div className="tl-form__links">
            {(isCreating
              ? draftLinks.map((link) => ({
                  key: `${link.objectType}:${link.objectId}`,
                  objectType: link.objectType,
                  objectId: link.objectId,
                  onRemove: () => setDraftLinks((prev) => prev.filter((entry) => entry.objectId !== link.objectId || entry.objectType !== link.objectType)),
                }))
              : (event?.links ?? []).map((link) => ({
                  key: link.id,
                  objectType: link.objectType,
                  objectId: link.objectId,
                  onRemove: () => { void handleRemoveLink(link.id, link.objectId); },
                }))
            ).map((chip) => (
              <span key={chip.key} className="tl-form__link-chip">
                <span className="tl-form__link-type">{getAnyObjectTypeLabel(chip.objectType as AnyObjectType)}</span>
                <span className="tl-form__link-name">{linkItems.get(chip.objectId)?.name ?? chip.objectId}</span>
                <button
                  type="button"
                  className="tl-form__link-remove"
                  onClick={chip.onRemove}
                  disabled={pendingLinkIds.has(chip.objectId)}
                  aria-label={t('common.delete')}
                >
                  <Close size="xs" />
                </button>
              </span>
            ))}
            <button type="button" className="tl-form__link-add" onClick={() => setShowLinkPicker((prev) => !prev)}>
              <Plus size="xs" />
              {t('timeline.eventModal.addLink')}
            </button>
          </div>
          {showLinkPicker && (
            <div className="tl-form__link-picker">
              <ObjectPicker
                mode="all"
                selectionMode="single"
                selectedIds=""
                onChange={(ids) => { void handlePickLink(ids); }}
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
    </BaseModal>
  );
};

export default EventEditModal;

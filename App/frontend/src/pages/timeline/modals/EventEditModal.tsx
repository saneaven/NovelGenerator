import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BaseModal from '../../../components/BaseModal/BaseModal';
import TextButton from '../../../components/TextButton/TextButton';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { StringChipInput } from '../../../components/ui/StringChipInput';
import ToggleSwitch from '../../../components/common/ToggleSwitch';
import ObjectPicker from '../../../components/ObjectPicker/ObjectPicker';
import type { ObjectPickerGroup, ObjectPickerItem } from '../../../components/ObjectPicker/types';
import { RichTextEditor } from '../../../components/RichTextEditor';
import { useContentReloadKey } from '../../../components/RichTextEditor/useContentReloadKey';
import { Close, Plus, Trash } from '../../../components/icons';
import { emptyDoc, normalizeDoc } from '../../../editor/richtext/doc';
import { confirm as confirmDialog } from '../../../store/dialogStore';
import { useSettings } from '../../../data/settings';
import { createEvent, updateEvent, deleteEvent } from '../../../data/timeline';
import { useObjectQuery } from '../../../data/objects/useObjectQuery';
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
import { useIsMobile } from '../hooks/useIsMobile';
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

function linkRequestKey(link: TimelineEventLinkRequest): string {
  return `${link.objectType}:${link.objectId}`;
}

function linkRequestsEqual(a: TimelineEventLinkRequest[], b: TimelineEventLinkRequest[]): boolean {
  if (a.length !== b.length) return false;
  return a.map(linkRequestKey).sort().join('\n') === b.map(linkRequestKey).sort().join('\n');
}

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
  const isMobile = useIsMobile();
  const settings = useSettings();
  // Story-entity editor pattern: details and content are separate tabs on
  // mobile; on desktop both are visible (content fills the remaining height).
  const [activeTab, setActiveTab] = useState<'details' | 'content'>('details');

  const isCreating = event === null;
  const canEditProjection = isCreating || Boolean(event?.languageState?.has_requested_language);
  const leafTracks = useMemo(() => collectLeafTracks(tracks, displayLanguage), [tracks, displayLanguage]);

  // Body is markdown in the collection; load the editable tiptap separately.
  const detail = useObjectQuery('timeline_event', event?.id, displayLanguage, { staleTime: Infinity });
  const contentReady = isCreating || !detail.isLoading;
  const { reloadKey } = useContentReloadKey(
    `timeline_event:${event?.id ?? 'new'}:${displayLanguage}`,
    detail.data?.version?.number ?? null,
  );

  const initial = useMemo(() => {
    if (event) {
      const data = (event.data ?? {}) as Record<string, unknown>;
      return {
        name: (data.name as string) || '',
        description: (data.description as string) || '',
        content: normalizeDoc((detail.data?.data as Record<string, unknown> | undefined)?.content),
        startDate: clampTimelineDate({ ...event.startDate }, calendar),
        endDate: event.endDate ? clampTimelineDate({ ...event.endDate }, calendar) : null,
        tags: [...event.tags],
        trackId: event.trackId,
        links: event.links.map((link) => ({ objectType: link.objectType, objectId: link.objectId })),
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
      links: [] as TimelineEventLinkRequest[],
    };
  }, [event, defaults, calendar, leafTracks, detail.data]);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [content, setContent] = useState<TipTapDoc>(initial.content);
  useEffect(() => {
    if (event && detail.data) {
      setContent(normalizeDoc((detail.data.data as Record<string, unknown> | undefined)?.content));
    }
  }, [event, detail.data]);
  const [startDate, setStartDate] = useState<TimelineDate>(initial.startDate);
  const [endDate, setEndDate] = useState<TimelineDate | null>(initial.endDate);
  const [tags, setTags] = useState<string[]>(initial.tags);
  const [trackId, setTrackId] = useState(initial.trackId);
  const [draftLinks, setDraftLinks] = useState<TimelineEventLinkRequest[]>(initial.links);
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement | null>(null);

  const linksDirty = !linkRequestsEqual(draftLinks, initial.links);

  const isDirty = name !== initial.name
    || description !== initial.description
    || trackId !== initial.trackId
    || JSON.stringify(startDate) !== JSON.stringify(initial.startDate)
    || JSON.stringify(endDate) !== JSON.stringify(initial.endDate)
    || JSON.stringify(tags) !== JSON.stringify(initial.tags)
    || linksDirty
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
    if (!canEditProjection) return;
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setActiveTab('details');
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
          // Don't overwrite the body before it has loaded.
          content: contentReady ? content : undefined,
          startDate,
          endDate,
          tags,
          links: linksDirty ? draftLinks : undefined,
        }, displayLanguage);
        onClose();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [canEditProjection, validate, isCreating, event, contentReady, createEvent, updateEvent, projectId, trackId, displayLanguage, name, description, content, startDate, endDate, tags, draftLinks, linksDirty, onClose, onCreated]);

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

    setDraftLinks((prev) => (
      prev.some((link) => link.objectType === target.type && link.objectId === objectId)
        ? prev
        : [...prev, { objectType: target.type, objectId }]
    ));
  }, [linkItems]);

  const handleRemoveLink = useCallback((objectType: string, objectId: string) => {
    setDraftLinks((prev) => prev.filter((entry) => entry.objectId !== objectId || entry.objectType !== objectType));
  }, []);

  const trackOptions = useMemo(() => leafTracks.map((track) => ({
    value: track.id,
    label: track.path,
  })), [leafTracks]);

  return (
    <BaseModal
      isOpen
      onClose={handleClose}
      showHeader={false}
      size="large"
      className="tl-event-modal tl-editor-modal"
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
            <TextButton variant="primary" onClick={handleSave} loading={isSaving} disabled={!canEditProjection}>
              {isCreating ? t('common.create') : t('common.save')}
            </TextButton>
          </div>
        </div>
      }
    >
      <div className="tl-modal-tabs" role="tablist">
        {isMobile ? (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'details'}
              className={`tl-modal-tab ${activeTab === 'details' ? 'tl-modal-tab--active' : ''}`}
              onClick={() => setActiveTab('details')}
            >
              {t('timeline.eventModal.tabDetails')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'content'}
              className={`tl-modal-tab ${activeTab === 'content' ? 'tl-modal-tab--active' : ''}`}
              onClick={() => setActiveTab('content')}
            >
              {t('timeline.eventModal.tabContent')}
            </button>
          </>
        ) : (
          <span className="tl-modal-tab tl-modal-tab--active" role="tab" aria-selected>
            {isCreating ? t('timeline.eventModal.createTitle') : t('timeline.eventModal.editTitle')}
          </span>
        )}
        <button
          type="button"
          className="tl-modal-tabs__close"
          onClick={handleClose}
          aria-label={t('common.close')}
          title={t('common.close')}
        >
          <Close size="sm" />
        </button>
      </div>

      <div className="tl-form tl-form--editor">
        {saveError && (
          <div className="tl-form__error-banner" role="alert">
            {t('timeline.eventModal.errors.saveFailed', { message: saveError })}
          </div>
        )}

        <div className={`tl-form__details ${isMobile && activeTab !== 'details' ? 'tl-form__section-hidden' : ''}`}>
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

        <div className="tl-form__field">
          <span className="tl-form__label">{t('timeline.eventModal.links')}</span>
          <div className="tl-form__links">
            {draftLinks.map((link) => ({
              key: `${link.objectType}:${link.objectId}`,
              objectType: link.objectType,
              objectId: link.objectId,
              onRemove: () => handleRemoveLink(link.objectType, link.objectId),
            })).map((chip) => (
              <span key={chip.key} className="tl-form__link-chip">
                <span className="tl-form__link-type">{getAnyObjectTypeLabel(chip.objectType as AnyObjectType)}</span>
                <span className="tl-form__link-name">{linkItems.get(chip.objectId)?.name ?? chip.objectId}</span>
                <button
                  type="button"
                  className="tl-form__link-remove"
                  onClick={chip.onRemove}
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
                language={settings.mainLanguage}
                customGroups={linkGroups}
                maxHeight={240}
              />
            </div>
          )}
        </div>
        </div>

        <div className={`tl-form__field tl-form__field--grow ${isMobile && activeTab !== 'content' ? 'tl-form__section-hidden' : ''}`}>
          <label className="tl-form__label">{t('timeline.eventModal.content')}</label>
          {contentReady
            ? <RichTextEditor key={reloadKey} initialContent={content} onChange={setContent} />
            : <div className="tl-form__content-loading">{t('common.loading')}</div>}
        </div>
      </div>
    </BaseModal>
  );
};

export default EventEditModal;

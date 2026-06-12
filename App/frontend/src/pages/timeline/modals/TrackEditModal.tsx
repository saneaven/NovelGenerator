import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BaseModal from '../../../components/BaseModal/BaseModal';
import TextButton from '../../../components/TextButton/TextButton';
import FormDisclosure from './FormDisclosure';
import { RichTextEditor } from '../../../components/RichTextEditor';
import { emptyDoc, normalizeDoc } from '../../../editor/manuscript/doc';
import { confirm as confirmDialog } from '../../../store/dialogStore';
import { useTimelineStore } from '../../../store/timelineStore';
import type { TipTapDoc } from '../../../types/tiptap';
import type { TimelineTrack } from '../../../types/timeline';
import { SWATCH_COLORS, oklchToHex } from '../timelineColors';
import './TimelineModals.css';

interface TrackEditModalProps {
  projectId: string;
  /** null = create mode */
  track: TimelineTrack | null;
  /** create mode: the parent under which the track is created */
  parentId: string | null;
  parentName: string | null;
  displayLanguage: string;
  onClose: () => void;
  onCreated?: (track: TimelineTrack) => void;
}

const TrackEditModal: React.FC<TrackEditModalProps> = ({
  projectId,
  track,
  parentId,
  parentName,
  displayLanguage,
  onClose,
  onCreated,
}) => {
  const { t } = useTranslation();
  const createTrack = useTimelineStore((s) => s.createTrack);
  const updateTrack = useTimelineStore((s) => s.updateTrack);

  const isCreating = track === null;
  const initial = useMemo(() => {
    if (!track) {
      // null = let the server assign an automatic color
      return { name: '', description: '', content: emptyDoc(), color: null as string | null };
    }
    const data = (track.data?.[displayLanguage] ?? Object.values(track.data ?? {})[0] ?? {}) as Record<string, unknown>;
    return {
      name: (data.name as string) || '',
      description: (data.description as string) || '',
      content: normalizeDoc(data.content),
      color: track.color as string | null,
    };
  }, [track, displayLanguage]);

  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [content, setContent] = useState<TipTapDoc>(initial.content);
  const [color, setColor] = useState<string | null>(initial.color);
  const [isSaving, setIsSaving] = useState(false);
  const [nameError, setNameError] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isDirty = name !== initial.name
    || description !== initial.description
    || color !== initial.color
    || JSON.stringify(content) !== JSON.stringify(initial.content);

  const handleClose = useCallback(async () => {
    if (isDirty) {
      const ok = await confirmDialog({
        title: t('timeline.eventModal.discardTitle'),
        message: t('timeline.eventModal.discardBody'),
        variant: 'warning',
        confirmLabel: t('common.confirm', 'Confirm'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
    }
    onClose();
  }, [isDirty, onClose, t]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      if (isCreating) {
        const created = await createTrack(projectId, {
          language: displayLanguage,
          name: name.trim(),
          description: description.trim(),
          content,
          parentId,
          color,
        }, displayLanguage);
        onClose();
        onCreated?.(created);
      } else if (track) {
        await updateTrack(projectId, track.id, {
          language: displayLanguage,
          name: name.trim(),
          description: description.trim(),
          content,
          // color cannot be cleared; only send it when actually changed
          ...(color !== null && color !== initial.color ? { color } : {}),
        }, displayLanguage);
        onClose();
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  }, [name, description, content, color, isCreating, track, parentId, projectId, displayLanguage, createTrack, updateTrack, onClose, onCreated]);

  return (
    <BaseModal
      isOpen
      onClose={handleClose}
      title={isCreating ? t('timeline.trackModal.createTitle') : t('timeline.trackModal.editTitle')}
      size="medium"
      footer={
        <div className="tl-modal-footer">
          <TextButton variant="secondary" onClick={handleClose}>{t('common.cancel')}</TextButton>
          <TextButton variant="primary" onClick={handleSave} disabled={!name.trim()} loading={isSaving}>
            {isCreating ? t('common.create') : t('common.save')}
          </TextButton>
        </div>
      }
    >
      <div className="tl-form">
        {saveError && (
          <div className="tl-form__error-banner" role="alert">
            {t('timeline.eventModal.errors.saveFailed', { message: saveError })}
          </div>
        )}

        {isCreating && (
          <div className="tl-form__context">
            {parentId ? t('timeline.trackModal.inside', { parent: parentName ?? '' }) : t('timeline.tree.topLevel')}
          </div>
        )}

        <div className="tl-form__field">
          <label className="tl-form__label" htmlFor="tl-track-name">{t('timeline.trackModal.name')}</label>
          <input
            id="tl-track-name"
            type="text"
            className={`tl-form__input ${nameError && !name.trim() ? 'tl-form__input--invalid' : ''}`}
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(false); }}
            placeholder={t('timeline.trackModal.namePlaceholder')}
            autoFocus={isCreating}
          />
          {nameError && !name.trim() && (
            <span className="tl-form__field-error" role="alert">{t('timeline.eventModal.errors.nameRequired')}</span>
          )}
        </div>

        <div className="tl-form__field">
          <span className="tl-form__label">{t('timeline.trackModal.color')}</span>
          <div className="tl-form__swatches" role="radiogroup" aria-label={t('timeline.trackModal.color')}>
            {isCreating && (
              <button
                type="button"
                role="radio"
                aria-checked={color === null}
                className={`tl-form__swatch tl-form__swatch--auto ${color === null ? 'tl-form__swatch--active' : ''}`}
                onClick={() => setColor(null)}
                title={t('timeline.trackModal.colorAuto')}
              />
            )}
            {SWATCH_COLORS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                role="radio"
                aria-checked={color === swatch}
                className={`tl-form__swatch ${color === swatch ? 'tl-form__swatch--active' : ''}`}
                style={{ background: swatch }}
                onClick={() => setColor(swatch)}
              />
            ))}
            <input
              type="color"
              className={`tl-form__swatch tl-form__swatch--custom ${color !== null && !SWATCH_COLORS.includes(color) ? 'tl-form__swatch--active' : ''}`}
              value={color ? (color.startsWith('#') ? color : oklchToHex(color)) : '#888888'}
              onChange={(e) => setColor(e.target.value)}
              title={t('timeline.trackModal.colorCustom')}
              aria-label={t('timeline.trackModal.colorCustom')}
            />
          </div>
        </div>

        <div className="tl-form__field">
          <label className="tl-form__label" htmlFor="tl-track-desc">{t('timeline.trackModal.description')}</label>
          <textarea
            id="tl-track-desc"
            className="tl-form__textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </div>

        <FormDisclosure label={t('timeline.trackModal.content')}>
          <RichTextEditor initialContent={content} onChange={setContent} />
        </FormDisclosure>
      </div>
    </BaseModal>
  );
};

export default TrackEditModal;

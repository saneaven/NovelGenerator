import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import BaseModal from '../../../components/BaseModal/BaseModal';
import TextButton from '../../../components/TextButton/TextButton';
import { useTimelineStore } from '../../../store/timelineStore';
import type { TimelineTrack } from '../../../types/timeline';
import { resolveEntityText } from '../layout/computeTimelineLayout';
import { trackColorProps } from '../timelineColors';
import './MoveTrackModal.css';

interface MoveTrackModalProps {
  projectId: string;
  track: TimelineTrack;
  tracks: TimelineTrack[];
  displayLanguage: string;
  onClose: () => void;
}

interface TargetOption {
  id: string | null;
  name: string;
  depth: number;
  color: string | null;
  disabled: boolean;
}

/** “Move to…” — re-parenting picker; same-parent ordering stays in the tree. */
const MoveTrackModal: React.FC<MoveTrackModalProps> = ({ projectId, track, tracks, displayLanguage, onClose }) => {
  const { t } = useTranslation();
  const moveTrack = useTimelineStore((s) => s.moveTrack);
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const options = useMemo<TargetOption[]>(() => {
    const excluded = new Set<string>();
    const markSubtree = (node: TimelineTrack) => {
      excluded.add(node.id);
      for (const child of node.children ?? []) markSubtree(child);
    };
    markSubtree(track);

    const result: TargetOption[] = [{
      id: null,
      name: t('timeline.tree.topLevel'),
      depth: 0,
      color: null,
      disabled: (track.parentId ?? null) === null,
    }];
    const walk = (list: TimelineTrack[], depth: number) => {
      for (const node of list) {
        if (excluded.has(node.id)) continue;
        const { name } = resolveEntityText(node.data, displayLanguage);
        const isLeafWithEvents = (node.children?.length ?? 0) === 0 && (node.events?.length ?? 0) > 0;
        result.push({
          id: node.id,
          name: name || t('timeline.tree.untitled'),
          depth: depth + 1,
          color: node.color,
          disabled: isLeafWithEvents || node.id === (track.parentId ?? null),
        });
        walk(node.children ?? [], depth + 1);
      }
    };
    walk(tracks, 0);
    return result;
  }, [tracks, track, displayLanguage, t]);

  const trackName = resolveEntityText(track.data, displayLanguage).name || t('timeline.tree.untitled');

  const handleSave = async () => {
    if (selected === undefined) return;
    setIsSaving(true);
    try {
      await moveTrack(projectId, track.id, { parentId: selected }, displayLanguage);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      title={`${t('timeline.tree.moveTo')} — ${trackName}`}
      size="small"
      footer={
        <div className="tl-modal-footer">
          <TextButton variant="secondary" onClick={onClose}>{t('common.cancel')}</TextButton>
          <TextButton variant="primary" onClick={handleSave} disabled={selected === undefined} loading={isSaving}>
            {t('common.save')}
          </TextButton>
        </div>
      }
    >
      <div className="tl-move-track" role="radiogroup">
        {options.map((option) => (
          <button
            key={option.id ?? '__root__'}
            type="button"
            role="radio"
            aria-checked={selected === option.id}
            className={[
              'tl-move-track__option',
              selected === option.id && 'tl-move-track__option--selected',
            ].filter(Boolean).join(' ')}
            style={{ '--tl-tree-depth': option.depth } as React.CSSProperties}
            disabled={option.disabled}
            title={option.disabled && option.id !== null && option.id !== (track.parentId ?? null)
              ? t('timeline.tree.cannotNestUnderLeafWithEvents')
              : undefined}
            onClick={() => setSelected(option.id)}
          >
            {option.id !== null && (
              <span
                className={`tl-tree__dot ${trackColorProps(option.color).className}`}
                style={trackColorProps(option.color).style}
                aria-hidden="true"
              />
            )}
            <span className="tl-move-track__name">{option.name}</span>
          </button>
        ))}
      </div>
    </BaseModal>
  );
};

export default MoveTrackModal;

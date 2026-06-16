import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useActivePresetId, useSubAgentsQuery } from '../../../data/presets';
import { Plus, SpeechBubble } from '../../icons';
import { TextButton } from '../../TextButton';
import './SubAgentListNav.css';

interface SubAgentListNavProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  newDraftLabel?: string | null;
  isNewDraftSelected?: boolean;
  onSelectNewDraft?: () => void;
}

const SubAgentListNav: React.FC<SubAgentListNavProps> = ({
  selectedId,
  onSelect,
  onCreate,
  newDraftLabel,
  isNewDraftSelected,
  onSelectNewDraft,
}) => {
  const { t } = useTranslation();
  const activePresetId = useActivePresetId();
  const { data: subAgents = [], isLoading } = useSubAgentsQuery(activePresetId);

  const sorted = useMemo(() => {
    return [...subAgents].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [subAgents]);

  return (
    <div className="sub-agent-list-nav">
      <div className="sub-agent-list-nav__list">
        {newDraftLabel && (
          <button
            type="button"
            className={`sub-agent-item ${isNewDraftSelected ? 'sub-agent-item--selected' : ''}`}
            onClick={onSelectNewDraft}
          >
            <span className="sub-agent-item__icon">
              <Plus size="sm" />
            </span>
            <span className="sub-agent-item__name">{newDraftLabel}</span>
            <span className="sub-agent-item__id">Unsaved</span>
          </button>
        )}
        {isLoading && sorted.length === 0 ? (
          <div className="sub-agent-list-nav__loading">Loading...</div>
        ) : sorted.length === 0 ? (
          <div className="sub-agent-list-nav__empty">
            <p>{t('settings.promptEditor.subAgentsEmpty')}</p>
            <p className="sub-agent-list-nav__empty-hint">
              {t('settings.promptEditor.subAgentsEmptyHint')}
            </p>
          </div>
        ) : (
          sorted.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`sub-agent-item ${selectedId === agent.id ? 'sub-agent-item--selected' : ''}`}
              onClick={() => onSelect(agent.id)}
            >
              <span className="sub-agent-item__icon">
                <SpeechBubble size="sm" />
              </span>
              <span className="sub-agent-item__name">
                {agent.display_name}
                {!agent.enabled && <span className="sub-agent-item__disabled">{t('common.disabled')}</span>}
              </span>
              <span className="sub-agent-item__id">{`call_${agent.agent_name}`}</span>
            </button>
          ))
        )}
      </div>

      <div className="sub-agent-list-nav__footer">
        <TextButton iconLeft={<Plus size="sm" />} onClick={onCreate}>
          {t('settings.promptEditor.addSubAgent')}
        </TextButton>
      </div>
    </div>
  );
};

export default SubAgentListNav;

import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePresetStore } from '../../../store/presetStore';
import { useSubAgentStore } from '../../../store/subAgentStore';
import { Plus, SpeechBubble } from '../../icons';
import { TextButton } from '../../TextButton';
import './SubAgentListNav.css';

interface SubAgentListNavProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClose?: () => void;
}

const SubAgentListNav: React.FC<SubAgentListNavProps> = ({
  selectedId,
  onSelect,
  onCreate,
  onClose,
}) => {
  const { t } = useTranslation();
  const activePresetId = usePresetStore((s) => s.activePresetId);
  const { subAgents, isLoading, loadSubAgents } = useSubAgentStore();

  useEffect(() => {
    loadSubAgents();
  }, [loadSubAgents, activePresetId]);

  const sorted = useMemo(() => {
    return [...subAgents].sort((a, b) => a.display_name.localeCompare(b.display_name));
  }, [subAgents]);

  return (
    <div className="sub-agent-list-nav">
      {onClose && (
        <div className="sub-agent-list-nav__header">
          <span className="sub-agent-list-nav__title">{t('settings.promptEditor.subAgents')}</span>
        </div>
      )}

      <div className="sub-agent-list-nav__list">
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

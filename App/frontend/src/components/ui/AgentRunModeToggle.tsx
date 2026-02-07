import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clipboard, Workspace } from '../icons';
import type { AgentRunMode } from '../../types/agentRuntime';
import './AgentModeToggle.css';

interface AgentRunModeToggleProps {
  currentRunMode: AgentRunMode;
  onRunModeChange: (mode: AgentRunMode) => void;
}

const AgentRunModeToggle: React.FC<AgentRunModeToggleProps> = ({
  currentRunMode,
  onRunModeChange,
}) => {
  const { t } = useTranslation();

  const config: Record<AgentRunMode, { icon: React.ReactNode; label: string }> = {
    planMode: { icon: <Clipboard size="sm" />, label: t('agentRunModeToggle.plan') },
    agentMode: { icon: <Workspace size="sm" />, label: t('agentRunModeToggle.agent') },
  };

  const handleToggle = () => {
    onRunModeChange(currentRunMode === 'planMode' ? 'agentMode' : 'planMode');
  };

  const current = config[currentRunMode];

  return (
    <button
      type="button"
      className="agent-mode-toggle"
      onClick={handleToggle}
      title={t('agentRunModeToggle.currentMode', { mode: current.label })}
    >
      <span className="agent-mode-toggle-icon">{current.icon}</span>
      <span className="agent-mode-toggle-label">{current.label}</span>
    </button>
  );
};

export default AgentRunModeToggle;

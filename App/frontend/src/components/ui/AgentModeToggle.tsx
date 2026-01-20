import React from 'react';
import { useTranslation } from 'react-i18next';
import { Workspace, Clipboard, Document } from '../icons';
import type { AgentMode } from '../../store/agentUIStore';
import './AgentModeToggle.css';

interface AgentModeToggleProps {
  currentMode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
}

const MODE_ORDER: AgentMode[] = ['storyObject', 'outlineManager', 'novelEditor'];

const AgentModeToggle: React.FC<AgentModeToggleProps> = ({
  currentMode,
  onModeChange,
}) => {
  const { t } = useTranslation();

  const MODE_CONFIG: Record<AgentMode, { icon: React.ReactNode; label: string }> = {
    storyObject: { icon: <Workspace size="sm" />, label: t('agentModeToggle.storyObjects') },
    outlineManager: { icon: <Clipboard size="sm" />, label: t('agentModeToggle.outline') },
    novelEditor: { icon: <Document size="sm" />, label: t('agentModeToggle.editor') },
  };

  const handleCycle = () => {
    const currentIndex = MODE_ORDER.indexOf(currentMode);
    const nextIndex = (currentIndex + 1) % MODE_ORDER.length;
    onModeChange(MODE_ORDER[nextIndex]);
  };

  const config = MODE_CONFIG[currentMode];

  return (
    <button
      type="button"
      className="agent-mode-toggle"
      onClick={handleCycle}
      title={t('agentModeToggle.currentMode', { mode: config.label })}
    >
      <span className="agent-mode-toggle-icon">{config.icon}</span>
      <span className="agent-mode-toggle-label">{config.label}</span>
    </button>
  );
};

export default AgentModeToggle;

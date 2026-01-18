import React from 'react';
import { Workspace, Clipboard, Document } from '../icons';
import type { AgentMode } from '../../store/agentUIStore';
import './AgentModeToggle.css';

interface AgentModeToggleProps {
  currentMode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
}

const MODE_CONFIG: Record<AgentMode, { icon: React.ReactNode; label: string }> = {
  storyObject: { icon: <Workspace size="sm" />, label: 'Story Objects' },
  outlineManager: { icon: <Clipboard size="sm" />, label: 'Outline' },
  novelEditor: { icon: <Document size="sm" />, label: 'Editor' },
};

const MODE_ORDER: AgentMode[] = ['storyObject', 'outlineManager', 'novelEditor'];

const AgentModeToggle: React.FC<AgentModeToggleProps> = ({
  currentMode,
  onModeChange,
}) => {
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
      title={`Current mode: ${config.label}. Click to switch.`}
    >
      <span className="agent-mode-toggle-icon">{config.icon}</span>
      <span className="agent-mode-toggle-label">{config.label}</span>
    </button>
  );
};

export default AgentModeToggle;

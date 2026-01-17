import React from 'react';
import { Settings } from '../icons';
import { ActivityPanelButton } from '../ActivityPanel';
import { IconButton } from '../IconButton';
import './MobileFooter.css';

export interface MobileFooterProps {
  isAgentVisible: boolean;
  onAgentToggle: () => void;
  onSettingsClick: () => void;
}

const MobileFooter: React.FC<MobileFooterProps> = ({
  isAgentVisible,
  onAgentToggle,
  onSettingsClick,
}) => {
  return (
    <footer className="mobile-footer">
      <IconButton
        icon={<Settings size="xl" />}
        onClick={onSettingsClick}
        title="Settings"
        size="sm"
      />

      <button
        className={`footer-agent-toggle-btn ${isAgentVisible ? 'active' : ''}`}
        onClick={onAgentToggle}
      >
        Agent
      </button>

      <ActivityPanelButton position="mobile" className="footer-notification-btn" />
    </footer>
  );
};

export default MobileFooter;

import React from 'react';
import { Settings } from '../icons';
import { NotificationButton } from '../Notification';
import { IconButton } from '../IconButton';
import './MobileFooter.css';

export interface MobileFooterProps {
  isChatVisible: boolean;
  onChatToggle: () => void;
  onSettingsClick: () => void;
}

const MobileFooter: React.FC<MobileFooterProps> = ({
  isChatVisible,
  onChatToggle,
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
        className={`footer-chat-toggle-btn ${isChatVisible ? 'active' : ''}`}
        onClick={onChatToggle}
      >
        Chat
      </button>

      <NotificationButton position="mobile" className="footer-notification-btn" />
    </footer>
  );
};

export default MobileFooter;

import React from 'react';
import { Settings } from '../icons';
import { NotificationButton } from '../Notification';
import '../Notification/Notification.css';
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
      <NotificationButton position="mobile" className="footer-notification-btn" />

      <button
        className={`footer-chat-toggle-btn ${isChatVisible ? 'active' : ''}`}
        onClick={onChatToggle}
      >
        Chat
      </button>

      <button
        className="footer-settings-btn"
        onClick={onSettingsClick}
        title="Settings"
      >
        <Settings size="xl" />
      </button>
    </footer>
  );
};

export default MobileFooter;

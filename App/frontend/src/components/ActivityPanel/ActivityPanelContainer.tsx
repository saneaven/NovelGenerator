import React from 'react';
import { useNotificationStore } from '../../store/notificationStore';
import { Bell, Sliders } from '../icons';
import NotificationsView from './NotificationsView';
import VariablesView from './VariablesView';

export type ActivityView = 'notifications' | 'variables';

interface ActivityPanelContainerProps {
  activeView: ActivityView;
  onViewChange: (view: ActivityView) => void;
  isMobile?: boolean;
}

const ActivityPanelContainer: React.FC<ActivityPanelContainerProps> = ({
  activeView,
  onViewChange,
  isMobile = false,
}) => {
  const removeAll = useNotificationStore((state) => state.removeAll);
  const notificationsMap = useNotificationStore((state) => state.notifications);

  const hasNotifications = Object.values(notificationsMap).some(
    (n) => n !== undefined && n.status !== 'idle'
  );

  const handleClearAll = () => {
    removeAll();
  };

  const title = activeView === 'notifications' ? 'Notifications' : 'Variables';

  return (
    <>
      {/* Header Island */}
      <div className="activity-panel-header">
        {activeView === 'notifications' && hasNotifications && (
          <button className="activity-panel-clear" onClick={handleClearAll}>
            Clear All
          </button>
        )}

        <span className="activity-panel-title">{title}</span>

        {activeView === 'notifications' ? (
          <button
            className="activity-panel-tab"
            onClick={() => onViewChange('variables')}
            title="Switch to Variables"
            aria-label="Switch to variables"
          >
            <Sliders size="sm" />
          </button>
        ) : (
          <button
            className="activity-panel-tab"
            onClick={() => onViewChange('notifications')}
            title="Switch to Notifications"
            aria-label="Switch to notifications"
          >
            <Bell size="sm" />
          </button>
        )}
      </div>

      {/* Views Container */}
      <div className="activity-panel-views">
        <div
          className="activity-panel-view activity-panel-view--notifications"
          data-active={activeView === 'notifications'}
        >
          <NotificationsView isMobile={isMobile} />
        </div>
        <div
          className="activity-panel-view activity-panel-view--variables"
          data-active={activeView === 'variables'}
        >
          <VariablesView isActive={activeView === 'variables'} />
        </div>
      </div>
    </>
  );
};

export default ActivityPanelContainer;

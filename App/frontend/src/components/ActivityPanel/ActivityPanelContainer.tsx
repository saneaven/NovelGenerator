import React from 'react';
import { notificationService } from '../../api/notificationService';
import { useTranslation } from 'react-i18next';
import { useNotificationStore, type NotificationEntry } from '../../store/notificationStore';
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
  const { t } = useTranslation();
  const detailNotificationId = useNotificationStore((state) => state.detailNotificationId);
  const removeManyFromServer = useNotificationStore((state) => state.removeManyFromServer);
  const restoreEntries = useNotificationStore((state) => state.restoreEntries);
  const notificationsMap = useNotificationStore((state) => state.notifications);

  const hasNotifications = Object.values(notificationsMap).some(
    (n) => n !== undefined
  );

  const handleClearAll = async () => {
    const entriesToRemove = Object.values(notificationsMap).filter(
      (entry): entry is NotificationEntry => entry !== undefined
    );
    if (!entriesToRemove.length) return;
    removeManyFromServer(entriesToRemove.map((entry) => entry.id));
    try {
      await notificationService.deleteAll({ only_read: false });
    } catch (error) {
      restoreEntries(entriesToRemove, detailNotificationId);
      console.warn('Failed to clear notifications', { error });
    }
  };

  const title = activeView === 'notifications' ? t('activity.notifications') : t('activity.variables');

  return (
    <>
      {/* Header Island */}
      <div className="activity-panel-header">
        {activeView === 'notifications' && hasNotifications && (
          <button className="activity-panel-clear" onClick={handleClearAll}>
            {t('activity.clearAll')}
          </button>
        )}

        <span className="activity-panel-title">{title}</span>

        {activeView === 'notifications' ? (
          <button
            className="activity-panel-tab"
            onClick={() => onViewChange('variables')}
            title={t('activity.switchToVariables')}
            aria-label={t('activity.switchToVariables')}
          >
            <Sliders size="sm" />
          </button>
        ) : (
          <button
            className="activity-panel-tab"
            onClick={() => onViewChange('notifications')}
            title={t('activity.switchToNotifications')}
            aria-label={t('activity.switchToNotifications')}
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

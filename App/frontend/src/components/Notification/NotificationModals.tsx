/**
 * NotificationModals - Renders all registered modal renderers
 * Consumers register their modals via notificationStore.registerModalRenderer()
 */

import React from 'react';
import { useNotificationStore } from '../../store/notificationStore';

export const NotificationModals: React.FC = () => {
  const modalRenderers = useNotificationStore((s) => s.modalRenderers);

  return (
    <>
      {Object.entries(modalRenderers).map(([source, render]) => (
        <React.Fragment key={source}>{render()}</React.Fragment>
      ))}
    </>
  );
};

export default NotificationModals;

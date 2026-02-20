import React from 'react';
import { BaseModal } from '../BaseModal';
import { useNotificationStore } from '../../store/notificationStore';
import JourneyNotificationDetail from './JourneyNotificationDetail';

const ImageTaskNotificationDetail: React.FC<{
  label: string;
  status: string;
  message: string;
  warning?: string;
  imageUrl?: string;
  onClose: () => void;
}> = ({ label, status, message, warning, imageUrl, onClose }) => (
  <BaseModal
    isOpen={true}
    onClose={onClose}
    size="large"
    title={label}
    className="notification-detail-modal notification-detail-modal--image"
  >
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 13, opacity: 0.8 }}>Status: {status}</div>
      <div style={{ fontSize: 14 }}>{message}</div>
      {warning ? (
        <div style={{ color: 'var(--color-danger, #c0392b)', fontSize: 13 }}>{warning}</div>
      ) : null}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={label}
          style={{ width: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: 10 }}
        />
      ) : null}
    </div>
  </BaseModal>
);

export const NotificationModals: React.FC = () => {
  const notifications = useNotificationStore((state) => state.notifications);
  const detailNotificationId = useNotificationStore((state) => state.detailNotificationId);
  const closeDetail = useNotificationStore((state) => state.closeDetail);

  const notification = detailNotificationId ? notifications[detailNotificationId] : undefined;
  if (!notification) return null;

  if (notification.source === 'journey') {
    const meta = notification.meta ?? {};
    const metaThreadId = typeof meta.thread_id === 'string' ? meta.thread_id : null;
    const threadId = notification.threadId ?? metaThreadId;
    if (!threadId) {
      return (
        <BaseModal
          isOpen={true}
          onClose={closeDetail}
          size="small"
          title={notification.label}
          className="notification-detail-modal notification-detail-modal--journey"
        >
          <div style={{ fontSize: 14 }}>{notification.message}</div>
        </BaseModal>
      );
    }

    return (
      <JourneyNotificationDetail
        threadId={threadId}
        label={notification.label}
        status={notification.status}
        message={notification.message}
        warning={notification.warning}
        projectId={notification.projectId}
        onClose={closeDetail}
      />
    );
  }

  const imageUrl = notification.customSlot.type === 'image'
    ? notification.customSlot.url
    : undefined;

  return (
    <ImageTaskNotificationDetail
      label={notification.label}
      status={notification.status}
      message={notification.message}
      warning={notification.warning}
      imageUrl={imageUrl}
      onClose={closeDetail}
    />
  );
};

export default NotificationModals;

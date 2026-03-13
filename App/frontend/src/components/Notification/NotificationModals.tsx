import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BaseModal } from '../BaseModal';
import AuthenticatedImage from '../common/AuthenticatedImage';
import { useNotificationStore } from '../../store/notificationStore';
import { journeyService, type JourneyDTO } from '../../api/journeyService';
import JourneyNotificationDetail from './JourneyNotificationDetail';

const ImageRunNotificationDetail: React.FC<{
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
        <AuthenticatedImage
          src={imageUrl}
          alt={label}
          style={{ width: '100%', maxHeight: 520, objectFit: 'contain', borderRadius: 10 }}
        />
      ) : null}
    </div>
  </BaseModal>
);

export const NotificationModals: React.FC = () => {
  const navigate = useNavigate();
  const notifications = useNotificationStore((state) => state.notifications);
  const detailNotificationId = useNotificationStore((state) => state.detailNotificationId);
  const closeDetail = useNotificationStore((state) => state.closeDetail);
  const [journeyDetail, setJourneyDetail] = useState<JourneyDTO | null>(null);
  const [journeyLoadError, setJourneyLoadError] = useState<string | null>(null);
  const [journeyLoading, setJourneyLoading] = useState(false);

  const notification = detailNotificationId ? notifications[detailNotificationId] : undefined;
  const projectTargetId = notification?.target.kind === 'project'
    ? notification.target.project_id ?? null
    : null;
  const journeyTargetId = notification?.target.kind === 'journey'
    ? notification.target.journey_id ?? null
    : null;

  useEffect(() => {
    if (!projectTargetId) return;
    navigate(`/project/${projectTargetId}`);
    closeDetail();
  }, [closeDetail, navigate, projectTargetId]);

  useEffect(() => {
    if (!journeyTargetId) {
      setJourneyDetail(null);
      setJourneyLoadError(null);
      setJourneyLoading(false);
      return;
    }

    let cancelled = false;
    setJourneyLoading(true);
    setJourneyLoadError(null);
    void journeyService.get(journeyTargetId)
      .then((row) => {
        if (cancelled) return;
        setJourneyDetail(row);
      })
      .catch((error) => {
        if (cancelled) return;
        setJourneyDetail(null);
        setJourneyLoadError(error instanceof Error ? error.message : 'Failed to load journey');
      })
      .finally(() => {
        if (!cancelled) {
          setJourneyLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [journeyTargetId]);

  if (!notification) return null;
  if (projectTargetId) return null;

  if (notification.source.kind === 'journey') {
    const threadId = notification.target.kind === 'thread'
      ? notification.target.thread_id ?? null
      : journeyDetail?.thread_id ?? null;
    const resolvedProjectId = notification.target.project_id
      ?? journeyDetail?.project_id
      ?? notification.projectId
      ?? '';
    if (!threadId) {
      return (
        <BaseModal
          isOpen={true}
          onClose={closeDetail}
          size="small"
          title={notification.label}
          className="notification-detail-modal notification-detail-modal--journey"
        >
          <div style={{ display: 'grid', gap: 10, fontSize: 14 }}>
            <div>{notification.message}</div>
            {journeyLoading ? <div>Loading journey details...</div> : null}
            {journeyLoadError ? <div>{journeyLoadError}</div> : null}
          </div>
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
        projectId={resolvedProjectId}
        onClose={closeDetail}
      />
    );
  }

  if (notification.source.kind !== 'imageRun') {
    return (
      <BaseModal
        isOpen={true}
        onClose={closeDetail}
        size="small"
        title={notification.label}
        className="notification-detail-modal"
      >
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 13, opacity: 0.8 }}>Status: {notification.status}</div>
          <div style={{ fontSize: 14 }}>{notification.message}</div>
          {notification.warning ? (
            <div style={{ color: 'var(--color-danger, #c0392b)', fontSize: 13 }}>
              {notification.warning}
            </div>
          ) : null}
        </div>
      </BaseModal>
    );
  }

  const imageUrl = notification.customSlot.type === 'image' ? notification.customSlot.url : undefined;

  return (
    <ImageRunNotificationDetail
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

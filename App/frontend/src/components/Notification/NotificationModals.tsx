import React, { useEffect, useMemo, useState } from 'react';
import type { ThreadMessage } from '../../types/thread';
import { threadService } from '../../api/threadService';
import { BaseModal } from '../BaseModal';
import { useNotificationStore } from '../../store/notificationStore';

function pickFirstThreadMessageText(message: ThreadMessage): string {
  const payload = message.data && typeof message.data === 'object'
    ? (message.data as Record<string, unknown>)
    : {};

  const finalEntry = payload._final && typeof payload._final === 'object'
    ? (payload._final as Record<string, unknown>)
    : null;

  const firstLanguageEntry = finalEntry ?? (
    Object.values(payload).find(
      (entry) => Boolean(entry) && typeof entry === 'object' && Array.isArray((entry as { contentParts?: unknown }).contentParts),
    ) as Record<string, unknown> | undefined
  );

  if (!firstLanguageEntry) return '';
  const contentParts = Array.isArray(firstLanguageEntry.contentParts)
    ? firstLanguageEntry.contentParts
    : [];

  return contentParts
    .filter((part): part is { type: string; text: string } => (
      Boolean(part) && typeof part === 'object'
      && typeof (part as { type?: unknown }).type === 'string'
      && typeof (part as { text?: unknown }).text === 'string'
    ))
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('')
    .trim();
}

const JourneyNotificationDetail: React.FC<{
  threadId: string;
  label: string;
  status: string;
  message: string;
  warning?: string;
  onClose: () => void;
}> = ({ threadId, label, status, message, warning, onClose }) => {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    void threadService
      .listMessages(threadId)
      .then((response) => {
        if (cancelled) return;
        setMessages(response.messages);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load journey messages');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  const displayMessages = useMemo(() => (
    messages
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .map((row) => ({
        id: row.id,
        role: row.role,
        text: pickFirstThreadMessageText(row),
      }))
      .filter((row) => row.text.length > 0)
  ), [messages]);

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      size="large"
      title={label}
      className="notification-detail-modal notification-detail-modal--journey"
    >
      <div style={{ display: 'grid', gap: 10 }}>
        <div style={{ fontSize: 13, opacity: 0.8 }}>Status: {status}</div>
        <div style={{ fontSize: 14 }}>{message}</div>
        {warning ? (
          <div style={{ color: 'var(--color-danger, #c0392b)', fontSize: 13 }}>{warning}</div>
        ) : null}

        {loading ? <div style={{ fontSize: 13 }}>Loading thread messages...</div> : null}
        {error ? <div style={{ color: 'var(--color-danger, #c0392b)', fontSize: 13 }}>{error}</div> : null}

        {!loading && !error ? (
          <div style={{ display: 'grid', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
            {displayMessages.length === 0 ? (
              <div style={{ fontSize: 13, opacity: 0.7 }}>No message history</div>
            ) : (
              displayMessages.map((row) => (
                <div
                  key={row.id}
                  style={{
                    border: '1px solid var(--color-border-soft, rgba(0,0,0,0.12))',
                    borderRadius: 10,
                    padding: 10,
                    background: row.role === 'assistant' ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.42)',
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>
                    {row.role === 'assistant' ? 'Assistant' : 'User'}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{row.text}</div>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </BaseModal>
  );
};

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

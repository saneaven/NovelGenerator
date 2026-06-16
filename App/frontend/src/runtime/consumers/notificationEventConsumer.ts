import type { NotificationSSEEvent } from '../../api/sseClient';
import {
  removeManyNotificationsFromSSE,
  removeNotificationFromSSE,
  upsertNotificationFromSSE,
} from '../../data/sse/sseNotificationBridge';

export class NotificationEventConsumer {
  constructor() {}

  consume(event: NotificationSSEEvent): void {
    if (event.event === 'notification:upsert') {
      upsertNotificationFromSSE(event.data);
      return;
    }

    if (event.event === 'notification:delete') {
      removeNotificationFromSSE(event.data.id);
      return;
    }

    if (event.event === 'notification:bulk_delete') {
      removeManyNotificationsFromSSE(event.data.ids);
    }
  }

  dispose(): void {
    // No-op: kept for API parity with other consumers.
  }
}

export default NotificationEventConsumer;

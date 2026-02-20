import type { NotificationSSEEvent } from '../../api/sseClient';
import { useNotificationStore } from '../../store/notificationStore';

export class NotificationEventConsumer {
  private readonly projectId: string;

  constructor(projectId: string) {
    this.projectId = projectId;
  }

  consume(event: NotificationSSEEvent): void {
    if (event.data.project_id !== this.projectId) {
      return;
    }

    if (event.event === 'notification:upsert') {
      useNotificationStore.getState().upsertFromServer(event.data);
      return;
    }

    if (event.event === 'notification:delete') {
      useNotificationStore.getState().removeFromServer(event.data.id);
      return;
    }

    if (event.event === 'notification:bulk_delete') {
      useNotificationStore.getState().removeManyFromServer(event.data.ids);
    }
  }

  dispose(): void {
    // No-op: kept for API parity with other consumers.
  }
}

export default NotificationEventConsumer;

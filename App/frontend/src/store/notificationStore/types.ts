import type { ComponentType } from 'react';

/**
 * Normalized notification status for display purposes.
 * All consumers must map their internal statuses to these.
 */
export type NotificationStatus =
  | 'idle'
  | 'running'    // Any active/in-progress state
  | 'pending'    // Requires user action (e.g., confirmation)
  | 'success'
  | 'error'
  | 'cancelled';

/**
 * Custom slot for consumer-specific rendering (e.g., thumbnails)
 */
export type NotificationCustomSlot =
  | { type: 'thumbnail'; url: string; alt?: string }
  | { type: 'component'; render: ComponentType<{ notification: NotificationData }> }
  | { type: 'none' };

/**
 * Progress information for running notifications
 */
export interface NotificationProgress {
  current: number;
  total: number;
  label?: string;
  percentage?: number;
}

/**
 * Core notification data - generic and consumer-agnostic
 */
export interface NotificationData {
  id: string;

  // Display properties
  label: string;
  message: string;
  status: NotificationStatus;

  // Timestamps
  createdAt: number;
  updatedAt: number;

  // Notification state
  isRead: boolean;

  // Progress (optional - for running tasks)
  progress?: NotificationProgress;

  // Consumer identification (e.g., 'llm', 'image', 'export')
  source: string;

  // Custom rendering slot (for thumbnails, extra UI elements)
  customSlot?: NotificationCustomSlot;

  // Warning message (optional)
  warning?: string;
}

/**
 * Handler configuration for notification interactions.
 * Consumers register these when adding notifications.
 */
export interface NotificationHandlers {
  /** Called when the notification is clicked */
  onClick?: () => void;
  /** Called before the notification is removed (cleanup) */
  onDismiss?: () => void;
  /** For cancellable tasks - shown only when running */
  onCancel?: () => void;
  /** For retryable tasks - shown on error */
  onRetry?: () => void;
}

/**
 * Full notification entry stored in the notification store
 */
export interface NotificationEntry extends NotificationData {
  handlers: NotificationHandlers;
}

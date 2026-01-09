import { useEffect, useRef, useCallback } from 'react';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { useImageTaskStore } from '../imageGeneration/store/imageTaskStore';
import { useNotificationStore } from '../store/notificationStore';
import {
  syncLLMTaskToNotifications,
  removeLLMTaskFromNotifications,
} from '../llmTask/notificationAdapter';
import {
  syncImageTaskToNotifications,
  removeImageTaskFromNotifications,
} from '../imageGeneration/notificationAdapter';
import type { ImageTaskState } from '../imageGeneration/types';

export interface NotificationSyncOptions {
  onOpenLLMDetail: (sessionId: string) => void;
  onOpenImagePreview: (assetId: string) => void;
  onOpenImageRetry: (task: ImageTaskState) => void;
}

/**
 * Hook that synchronizes domain stores with the notification store.
 * Must be rendered at app root level (inside NotificationModals component).
 */
export function useNotificationSync(options: NotificationSyncOptions): void {
  const llmSessions = useLLMTaskStore((state) => state.sessions);
  const imageTasks = useImageTaskStore((state) => state.tasks);

  // Track previous IDs to detect removals
  const prevLLMIds = useRef<Set<string>>(new Set());
  const prevImageIds = useRef<Set<string>>(new Set());

  // Stable callbacks for adapters
  const llmOptions = useCallback(
    () => ({
      onOpenDetail: options.onOpenLLMDetail,
    }),
    [options.onOpenLLMDetail]
  );

  const imageOptions = useCallback(
    () => ({
      onOpenPreview: options.onOpenImagePreview,
      onOpenRetry: options.onOpenImageRetry,
    }),
    [options.onOpenImagePreview, options.onOpenImageRetry]
  );

  // Sync LLM tasks
  useEffect(() => {
    const currentIds = new Set<string>();

    for (const [id, session] of Object.entries(llmSessions)) {
      if (session && session.status !== 'idle') {
        currentIds.add(id);
        syncLLMTaskToNotifications(session, llmOptions());
      }
    }

    // Remove notifications for sessions that no longer exist
    for (const id of prevLLMIds.current) {
      if (!currentIds.has(id)) {
        removeLLMTaskFromNotifications(id);
      }
    }

    prevLLMIds.current = currentIds;
  }, [llmSessions, llmOptions]);

  // Sync Image tasks
  useEffect(() => {
    const currentIds = new Set<string>();

    for (const [id, task] of Object.entries(imageTasks)) {
      if (task && task.status !== 'idle') {
        currentIds.add(id);
        syncImageTaskToNotifications(task, imageOptions());
      }
    }

    // Remove notifications for tasks that no longer exist
    for (const id of prevImageIds.current) {
      if (!currentIds.has(id)) {
        removeImageTaskFromNotifications(id);
      }
    }

    prevImageIds.current = currentIds;
  }, [imageTasks, imageOptions]);

  // Clean up all notifications on unmount
  useEffect(() => {
    return () => {
      const { removeBySource } = useNotificationStore.getState();
      removeBySource('llm');
      removeBySource('image');
    };
  }, []);
}

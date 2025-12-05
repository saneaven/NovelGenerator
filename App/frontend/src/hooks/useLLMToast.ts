import { useCallback, useRef } from 'react';
import {
  useLLMTaskStore,
  type LLMTaskType,
  type RetryContext,
} from '../store/llmTaskStore';

interface UseLLMToastOptions {
  taskType: LLMTaskType;
  label: string;
  sessionId: string;
}

interface UseLLMToastReturn {
  /** Call when starting the LLM request */
  startTask: (retryContext?: RetryContext) => void;

  /** Call for progress updates (batch operations) */
  updateProgress: (current: number, total: number, currentItemLabel?: string) => void;

  /** Call when task completes successfully */
  completeSuccess: () => void;

  /** Call when task fails */
  completeError: (message: string) => void;

  /** Call when task is cancelled */
  completeCancelled: () => void;

  /** Whether a session exists for this task */
  hasSession: boolean;
}

/**
 * Hook for integrating LLM task notifications with the toast system.
 *
 * Usage:
 * ```tsx
 * const { startTask, completeSuccess, completeError } = useLLMToast({
 *   taskType: 'ai-edit',
 *   label: 'AI Character Edit',
 *   sessionId: mySessionId,
 * });
 *
 * // When starting the LLM request
 * startTask({
 *   taskType: 'ai-edit',
 *   modalProps: { projectId, category, targetId },
 *   formState: { userRequest, contextOptions },
 * });
 *
 * // On success
 * completeSuccess();
 *
 * // On error
 * completeError('Request failed');
 * ```
 */
export function useLLMToast(options: UseLLMToastOptions): UseLLMToastReturn {
  const { sessionId } = options;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const setRunning = useLLMTaskStore((state) => state.setRunning);
  const setProgress = useLLMTaskStore((state) => state.setProgress);
  const setSuccess = useLLMTaskStore((state) => state.setSuccess);
  const setTaskError = useLLMTaskStore((state) => state.setTaskError);
  const setCancelled = useLLMTaskStore((state) => state.setCancelled);
  const getSessionById = useLLMTaskStore((state) => state.getSessionById);

  const hasSession = getSessionById(sessionId) !== undefined;

  const startTask = useCallback(
    (retryContext?: RetryContext) => {
      const { taskType: type, label: lbl, sessionId: id } = optionsRef.current;
      setRunning(id, lbl, type, retryContext);
    },
    [setRunning]
  );

  const updateProgress = useCallback(
    (current: number, total: number, currentItemLabel?: string) => {
      setProgress(optionsRef.current.sessionId, current, total, currentItemLabel);
    },
    [setProgress]
  );

  const completeSuccess = useCallback(() => {
    setSuccess(optionsRef.current.sessionId);
  }, [setSuccess]);

  const completeError = useCallback(
    (message: string) => {
      setTaskError(optionsRef.current.sessionId, message);
    },
    [setTaskError]
  );

  const completeCancelled = useCallback(() => {
    setCancelled(optionsRef.current.sessionId);
  }, [setCancelled]);

  return {
    startTask,
    updateProgress,
    completeSuccess,
    completeError,
    completeCancelled,
    hasSession,
  };
}

export default useLLMToast;

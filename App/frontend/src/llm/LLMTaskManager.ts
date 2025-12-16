import { useLLMTaskStore, type LLMTaskType, type RetryContext } from '../store/llmTaskStore';
import { generateTempId } from '../utils/tempId';

/**
 * Handle returned by LLMTaskManager.startTask()
 * Contains the session ID and bound completion functions
 */
export interface TaskHandle {
  /** Unique session ID for this task */
  sessionId: string;
  /** Mark task as successfully completed */
  complete: () => void;
  /** Mark task as failed with error message */
  error: (message: string) => void;
  /** Mark task as cancelled */
  cancel: () => void;
  /** Update progress for batch operations */
  updateProgress: (current: number, total: number, currentItemLabel?: string) => void;
}

/**
 * Options for starting a new LLM task
 */
export interface StartTaskOptions {
  /** Type of task for categorization */
  taskType: LLMTaskType;
  /** Display label for the toast notification */
  label: string;
  /** Optional retry context for task recovery */
  retryContext?: RetryContext;
}

/**
 * LLM Task Manager - Centralized session ID management
 *
 * This manager solves the race condition issue where multiple concurrent tasks
 * would overwrite each other's session IDs when using shared refs in hooks.
 *
 * Each call to startTask() generates a unique session ID and returns bound
 * completion functions that are guaranteed to use the correct session ID.
 *
 * @example
 * ```typescript
 * const handleSubmit = async () => {
 *   const task = LLMTaskManager.startTask({
 *     taskType: 'chapter-edit',
 *     label: 'AI Edit: Chapter 1',
 *   });
 *
 *   try {
 *     // ... perform LLM task using task.sessionId ...
 *     task.complete();
 *   } catch (err) {
 *     task.error(err.message);
 *   }
 * };
 * ```
 */
export const LLMTaskManager = {
  /**
   * Start a new LLM task with a unique session ID
   * @param options Task configuration
   * @returns TaskHandle with sessionId and bound completion functions
   */
  startTask(options: StartTaskOptions): TaskHandle {
    const sessionId = `llm-task-${generateTempId()}`;
    const store = useLLMTaskStore.getState();

    // Initialize session as running
    store.setRunning(sessionId, options.label, options.taskType, options.retryContext);

    // Return handle with bound completion functions
    // These functions capture the sessionId in their closure, preventing the
    // race condition that occurred with shared refs
    return {
      sessionId,
      complete: () => store.setSuccess(sessionId),
      error: (message: string) => store.setTaskError(sessionId, message),
      cancel: () => store.cancelTask(sessionId),
      updateProgress: (current: number, total: number, currentItemLabel?: string) =>
        store.setProgress(sessionId, current, total, currentItemLabel),
    };
  },

  /**
   * Get the current state of a session
   * @param sessionId Session ID to look up
   * @returns Session state or undefined if not found
   */
  getSession(sessionId: string) {
    return useLLMTaskStore.getState().getSessionById(sessionId);
  },

  /**
   * Clear/remove a session from the store
   * @param sessionId Session ID to clear
   */
  clearSession(sessionId: string) {
    useLLMTaskStore.getState().clearSession(sessionId);
  },

  /**
   * Set content parts for streaming display
   * @param sessionId Session ID
   * @param contentParts Content parts to set
   */
  setContentParts(sessionId: string, contentParts: import('../llm/requestTypes').ContentPart[]) {
    useLLMTaskStore.getState().setContentParts(sessionId, contentParts);
  },

  /**
   * Set function call progress for display
   * @param sessionId Session ID
   * @param progress Function call progress array
   */
  setFunctionCallProgress(sessionId: string, progress: import('../llm/requestTypes').FunctionCallProgress[]) {
    useLLMTaskStore.getState().setFunctionCallProgress(sessionId, progress);
  },

  /**
   * Register an AbortController for a session
   * @param sessionId Session ID
   * @param controller AbortController to register
   */
  registerAbortController(sessionId: string, controller: AbortController) {
    useLLMTaskStore.getState().registerAbortController(sessionId, controller);
  },

  /**
   * Cancel a running task by aborting the request and updating status
   * @param sessionId Session ID to cancel
   */
  cancelTask(sessionId: string) {
    useLLMTaskStore.getState().cancelTask(sessionId);
  },
};

export default LLMTaskManager;

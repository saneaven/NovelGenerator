/**
 * Function Call Handlers Hook
 *
 * Manages function call application and EditCard state for workspace chat.
 * Uses the new unified function call system.
 */

import { useCallback, useRef, useMemo, useState } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { LLMTaskManager } from '../../../llm/LLMTaskManager';
import type { FunctionCallMetadata, FunctionCallResultSummary, FunctionCallProgress } from '../../../llm/requestTypes';
import {
  UnifiedApplicator,
  useEditCardStore,
  buildEditCards,
  getFunctionDisplayName,
  type StoreActions,
  type RawFunctionCall,
  type EditCard,
} from '../../../functionCall';

/**
 * Create StoreActions adapter from Zustand store
 */
function createStoreActions(store: ReturnType<typeof useUnifiedObjectStore.getState>): StoreActions {
  return {
    getObject: (id) => store.getObject(id),
    fetchObject: (type, id) => store.fetchObject(type, id),
    listObjects: (type, projectId) => store.listObjects(type, projectId),
    createObject: (type, projectId, data, language, metadata, userRequest) =>
      store.createObject(type, projectId, data, language, metadata, userRequest),
    updateObject: (type, id, request) => store.updateObject(type, id, request),
    deleteObject: (type, id) => store.deleteObject(type, id),
  };
}

export function useFunctionCallHandlers(projectId: string | undefined) {
  const { updateMessageFunctionCalls, updateFunctionCallStatus, getSelectedChatId } = useChatStore();
  const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);

  // EditCard store
  const editCardStore = useEditCardStore();

  // Get cardsByMessage for reactivity - convert to Record when accessed
  const cardsByMessage = useEditCardStore(state => state.cardsByMessage);

  // Convert Map to Record for backward compatibility (computed on access, not every render)
  const messageEditCards = useMemo(() => {
    const record: Record<string, EditCard[]> = {};
    cardsByMessage.forEach((cardMap, messageId) => {
      record[messageId] = Array.from(cardMap.values());
    });
    return record;
  }, [cardsByMessage]);

  // Create applicator with memoized store actions
  const applicator = useMemo(() => {
    const storeActions = createStoreActions(useUnifiedObjectStore.getState());
    return new UnifiedApplicator({ store: storeActions });
  }, []);

  // Pending function call results for next prompt (reactive state)
  const [pendingFunctionCallResults, setPendingFunctionCallResultsState] = useState<FunctionCallResultSummary[]>([]);
  const pendingResultsRef = useRef<FunctionCallResultSummary[]>([]);

  // Wrapper to update both ref and state
  const addPendingResult = useCallback((result: FunctionCallResultSummary) => {
    pendingResultsRef.current.push(result);
    setPendingFunctionCallResultsState([...pendingResultsRef.current]);
  }, []);

  // Direct setter for pending results
  const setPendingFunctionCallResults = useCallback((results: FunctionCallResultSummary[]) => {
    pendingResultsRef.current = results;
    setPendingFunctionCallResultsState(results);
  }, []);

  // Active streaming function calls (with state for reactivity)
  const activeFunctionCallsRef = useRef<Record<string, FunctionCallProgress[]>>({});
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, FunctionCallProgress[]>>({});

  // Store sessionId by message ID for error propagation
  const messageSessionMap = useRef<Record<string, string>>({});

  const getActiveChatId = useCallback(
    () => (projectId ? getSelectedChatId(projectId) : undefined),
    [projectId, getSelectedChatId]
  );

  /**
   * Create apply handler for a function call
   */
  const createApplyHandler = useCallback(
    (messageId: string, functionCall: FunctionCallMetadata) => {
      return async () => {
        if (!projectId) return;
        const chatId = getActiveChatId();
        if (!chatId) return;

        try {
          // Convert to RawFunctionCall format
          const rawFunctionCall: RawFunctionCall = {
            id: functionCall.id,
            function_name: functionCall.function_name,
            arguments: functionCall.arguments,
          };

          const result = await applicator.apply(rawFunctionCall, {
            projectId,
            language: mainLanguage,
            mode: 'workspace',
          });

          // Get fresh store reference for mutations
          const cardStore = useEditCardStore.getState();

          if (result.success) {
            updateFunctionCallStatus(projectId, chatId, messageId, functionCall.id, true, result, undefined, result.message);

            cardStore.applyResult(
              messageId,
              functionCall.id,
              result,
              'Applied by User',
              `${getFunctionDisplayName(functionCall.function_name)} was successfully applied`
            );

            addPendingResult({
              functionCallId: functionCall.id,
              functionName: functionCall.function_name,
              success: true,
              resultMessage: result.message,
              appliedAt: new Date(),
            });
          } else {
            console.error('Failed to apply function call:', result.error || result.message);

            // Propagate error to toast if sessionId is available
            const sessionId = messageSessionMap.current[messageId];
            if (sessionId) {
              LLMTaskManager.setSessionError(sessionId, `Function call failed: ${result.error || result.message}`);
            }

            updateFunctionCallStatus(projectId, chatId, messageId, functionCall.id, false, result, result.error, result.error || result.message);

            addPendingResult({
              functionCallId: functionCall.id,
              functionName: functionCall.function_name,
              success: false,
              resultMessage: result.error || result.message,
              appliedAt: new Date(),
            });

            cardStore.applyResult(
              messageId,
              functionCall.id,
              result,
              'Apply Failed',
              `${getFunctionDisplayName(functionCall.function_name)} failed: ${result.error || result.message}`
            );
          }
        } catch (error) {
          console.error('Error applying function call:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Propagate error to toast if sessionId is available
          const sessionId = messageSessionMap.current[messageId];
          if (sessionId) {
            LLMTaskManager.setSessionError(sessionId, `Function call error: ${errorMessage}`);
          }

          // Update chat store status
          const chatIdForError = getActiveChatId();
          if (chatIdForError) {
            updateFunctionCallStatus(projectId, chatIdForError, messageId, functionCall.id, false, undefined, errorMessage, errorMessage);
          }

          // Set apply error but keep card pending
          useEditCardStore.getState().setApplyError(messageId, functionCall.id, errorMessage);
        }
      };
    },
    [projectId, getActiveChatId, applicator, mainLanguage, updateFunctionCallStatus, addPendingResult]
  );

  /**
   * Create reject handler for a function call
   */
  const createRejectHandler = useCallback(
    (messageId: string, functionCall: FunctionCallMetadata) => {
      return async () => {
        if (!projectId) return;
        const chatId = getActiveChatId();
        if (!chatId) return;

        const rejectionMessage = 'User rejected the function call';
        updateFunctionCallStatus(projectId, chatId, messageId, functionCall.id, true, undefined, undefined, rejectionMessage);

        useEditCardStore.getState().rejectCard(
          messageId,
          functionCall.id,
          `${getFunctionDisplayName(functionCall.function_name)} was rejected by user`
        );

        addPendingResult({
          functionCallId: functionCall.id,
          functionName: functionCall.function_name,
          success: false,
          resultMessage: rejectionMessage,
          appliedAt: new Date(),
        });
      };
    },
    [projectId, getActiveChatId, updateFunctionCallStatus, addPendingResult]
  );

  /**
   * Handle incoming function calls from LLM response
   */
  const handleFunctionCalls = useCallback(
    (messageId: string, functionCalls: FunctionCallMetadata[]) => {
      if (!projectId) return;
      const chatId = getActiveChatId();
      if (!chatId) return;

      // Update chat store
      updateMessageFunctionCalls(projectId, chatId, messageId, functionCalls);

      // Build EditCards
      const rawCalls: RawFunctionCall[] = functionCalls.map(fc => ({
        id: fc.id,
        function_name: fc.function_name,
        arguments: fc.arguments,
      }));

      const cards = buildEditCards(rawCalls, {
        createApplyHandler: (normalized) => {
          const original = functionCalls.find(fc => fc.id === normalized.id);
          if (!original) return () => {};
          return createApplyHandler(messageId, original);
        },
        createRejectHandler: (normalized) => {
          const original = functionCalls.find(fc => fc.id === normalized.id);
          if (!original) return () => {};
          return createRejectHandler(messageId, original);
        },
      });

      // Restore applied status from original function calls
      const restoredCards: EditCard[] = cards.map(card => {
        const original = functionCalls.find(fc => fc.id === card.id);
        if (original) {
          return {
            ...card,
            isApplied: original.isApplied,
            isRejected: original.isRejected,
            appliedAt: original.appliedAt,
          };
        }
        return card;
      });

      useEditCardStore.getState().setCardsForMessage(messageId, restoredCards);

      // Clear active function calls for this message
      delete activeFunctionCallsRef.current[messageId];
      setActiveFunctionCalls({ ...activeFunctionCallsRef.current });
    },
    [projectId, getActiveChatId, updateMessageFunctionCalls, createApplyHandler, createRejectHandler]
  );

  /**
   * Handle batch confirmation of function calls
   */
  const handleBatchConfirm = useCallback(
    async (messageId: string, selections: Record<string, boolean>) => {
      if (!projectId) return;
      const chatId = getActiveChatId();
      if (!chatId) return;

      const cardStore = useEditCardStore.getState();
      const cards = cardStore.getCardsForMessage(messageId);
      if (cards.length === 0) return;

      for (const card of cards) {
        // Skip cards with validation errors
        if (card.validationError) continue;

        const isSelected = selections[card.id] ?? true;

        if (isSelected) {
          // Apply the function call
          if (card.functionCall) {
            const rawFunctionCall: RawFunctionCall = {
              id: card.functionCall.id,
              function_name: card.functionCall.functionName,
              arguments: card.functionCall.arguments,
            };

            try {
              const result = await applicator.apply(rawFunctionCall, {
                projectId,
                language: mainLanguage,
                mode: 'workspace',
              });

              // Get fresh store reference after async operation
              const store = useEditCardStore.getState();

              if (result.success) {
                updateFunctionCallStatus(projectId, chatId, messageId, card.id, true, result, undefined, result.message, false);

                store.applyResult(messageId, card.id, result, 'Applied', result.message);

                addPendingResult({
                  functionCallId: card.id,
                  functionName: card.functionCall.functionName,
                  success: true,
                  resultMessage: result.message,
                  appliedAt: new Date(),
                });
              } else {
                console.error('Function call failed:', card.functionCall.functionName, result.error || result.message);
                updateFunctionCallStatus(projectId, chatId, messageId, card.id, true, result, result.error, result.error || result.message, false);

                store.applyResult(messageId, card.id, result, 'Apply Failed', result.error || result.message);

                addPendingResult({
                  functionCallId: card.id,
                  functionName: card.functionCall.functionName,
                  success: false,
                  resultMessage: result.error || result.message,
                  appliedAt: new Date(),
                });
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              console.error('Error applying function call in batch:', errorMessage);

              // Keep card pending with error (error is shown via the card's error state)
              useEditCardStore.getState().setApplyError(messageId, card.id, errorMessage);
            }
          }
        } else {
          // Reject the function call
          const functionName = card.functionCall?.functionName ?? 'Unknown';
          const rejectionMessage = `User rejected: ${getFunctionDisplayName(functionName)}`;

          updateFunctionCallStatus(projectId, chatId, messageId, card.id, true, undefined, undefined, rejectionMessage, true);

          useEditCardStore.getState().rejectCard(messageId, card.id, rejectionMessage);

          addPendingResult({
            functionCallId: card.id,
            functionName,
            success: false,
            isRejected: true,
            resultMessage: rejectionMessage,
            appliedAt: new Date(),
          });
        }
      }

      // Mark message as confirmed
      useEditCardStore.getState().confirmMessage(messageId);
    },
    [projectId, getActiveChatId, applicator, mainLanguage, updateFunctionCallStatus, addPendingResult]
  );

  /**
   * Check if message is confirmed
   */
  const isMessageConfirmed = useCallback(
    (messageId: string): boolean => {
      return useEditCardStore.getState().isMessageConfirmed(messageId);
    },
    []
  );

  /**
   * Handle function call progress during streaming
   */
  const handleFunctionCallProgress = useCallback(
    (messageId: string, progressList: FunctionCallProgress[]) => {
      if (progressList.length === 0) return;

      const current = activeFunctionCallsRef.current[messageId] || [];

      progressList.forEach(progress => {
        const existingIndex = current.findIndex(item => item.draft.index === progress.draft.index);
        if (existingIndex === -1) {
          current.push(progress);
        } else {
          current[existingIndex] = progress;
        }
      });

      activeFunctionCallsRef.current[messageId] = current;

      // Update state for reactivity
      setActiveFunctionCalls({ ...activeFunctionCallsRef.current });
    },
    []
  );

  /**
   * Register a sessionId for a message
   */
  const registerSessionForMessage = useCallback(
    (messageId: string, sessionId: string) => {
      messageSessionMap.current[messageId] = sessionId;
    },
    []
  );

  /**
   * Get pending function call results
   */
  const getPendingResults = useCallback((): FunctionCallResultSummary[] => {
    return [...pendingResultsRef.current];
  }, []);

  /**
   * Clear pending function call results
   */
  const clearPendingResults = useCallback(() => {
    pendingResultsRef.current = [];
    setPendingFunctionCallResultsState([]);
  }, []);

  /**
   * Get message EditCards
   */
  const getMessageEditCards = useCallback(
    (messageId: string): EditCard[] => {
      return useEditCardStore.getState().getCardsForMessage(messageId);
    },
    []
  );

  /**
   * Set message EditCards (for restoration from persisted state)
   */
  const setMessageEditCards = useCallback(
    (cards: Record<string, EditCard[]>) => {
      const store = useEditCardStore.getState();
      Object.entries(cards).forEach(([messageId, messageCards]) => {
        store.setCardsForMessage(messageId, messageCards);
      });
    },
    []
  );

  /**
   * Set confirmed messages (for restoration from persisted state)
   */
  const setConfirmedMessages = useCallback(
    (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
      const store = useEditCardStore.getState();
      // Get current confirmed state
      const current: Record<string, boolean> = {};
      store.cardsByMessage.forEach((_cards, messageId) => {
        current[messageId] = store.isMessageConfirmed(messageId);
      });

      // Apply updater
      const updated = updater(current);

      // Mark messages as confirmed
      Object.entries(updated).forEach(([messageId, isConfirmed]) => {
        if (isConfirmed) {
          store.confirmMessage(messageId);
        }
      });
    },
    [] // No dependencies - uses getState() for fresh data
  );

  /**
   * Get active function calls during streaming
   */
  const getActiveFunctionCalls = useCallback(
    (messageId: string): FunctionCallProgress[] => {
      return activeFunctionCallsRef.current[messageId] || [];
    },
    []
  );

  return {
    // Backward-compatible reactive state (for Workspace)
    messageEditCards,
    activeFunctionCalls,
    pendingFunctionCallResults,

    // State setters (for restoration from persisted state)
    setMessageEditCards,
    setConfirmedMessages,
    setPendingFunctionCallResults,

    // EditCard access (function-based)
    getMessageEditCards,
    getActiveFunctionCalls,

    // Handlers
    handleFunctionCalls,
    handleFunctionCallProgress,
    handleBatchConfirm,
    isMessageConfirmed,

    // Individual card handlers (with aliases for backward compatibility)
    createApplyHandler,
    createRejectHandler,
    createFunctionCallApplyHandler: createApplyHandler,
    createFunctionCallRejectHandler: createRejectHandler,

    // Session management
    registerSessionForMessage,

    // Pending results
    getPendingResults,
    clearPendingResults,

    // Direct store access (for compatibility)
    editCardStore,
  };
}

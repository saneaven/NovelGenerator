/**
 * Common Function Call Handlers Hook
 *
 * Provides unified function call handling logic for both Agent (message-based)
 * and AI Edit (session-based) flows. Extracted from useAgentOrchestration.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { LLMTaskManager } from '../../llm/LLMTaskManager';
import {
  UnifiedApplicator,
  createStoreActions,
  buildEditCards,
  applyValidationResults,
  getFunctionDisplayName,
  validate,
  normalizeFunctionCall,
  type RawFunctionCall,
  type NormalizedFunctionCall,
  type EditCard,
} from '../index';
import { useEditCardStore } from '../editCards/EditCardStore';
import type { FunctionCallMetadata, FunctionCallProgress } from '../../llm/requestTypes';
import type {
  UseFunctionCallHandlersConfig,
  UseFunctionCallHandlersReturn,
} from './types';

// ============================================================================
// STANDALONE UTILITY FUNCTIONS (for use outside React components)
// ============================================================================

export interface ProcessFunctionCallsConfig {
  projectId: string;
  language: string;
  sessionId: string;
}

/**
 * Process function calls and store them in EditCardStore (session-based).
 * This is a standalone function for use in callbacks after component unmount.
 */
export async function processFunctionCallsForSession(
  functionCalls: FunctionCallMetadata[],
  config: ProcessFunctionCallsConfig
): Promise<void> {
  const { projectId, language, sessionId } = config;
  const store = useEditCardStore.getState();

  // Create applicator
  const storeActions = createStoreActions(useUnifiedObjectStore.getState());
  const applicator = new UnifiedApplicator({ store: storeActions });

  const rawCalls: RawFunctionCall[] = functionCalls.map(fc => ({
    id: fc.id,
    function_name: fc.function_name,
    arguments: fc.arguments,
  }));

  // Create apply handler factory
  const createApplyHandler = (normalized: NormalizedFunctionCall) => {
    return async () => {
      try {
        const rawFunctionCall: RawFunctionCall = {
          id: normalized.id,
          function_name: normalized.functionName,
          arguments: normalized.arguments,
        };

        // Re-validate before Apply
        const validationResults = await validate([normalized]);
        const validationResult = validationResults.get(normalized.id);

        if (validationResult && !validationResult.valid) {
          useEditCardStore.getState().applySessionResult(
            sessionId,
            normalized.id,
            { success: false, message: 'Validation failed', error: validationResult.error },
            'Validation Failed',
            `${getFunctionDisplayName(normalized.functionName)}: ${validationResult.error}`
          );
          return;
        }

        const result = await applicator.apply(rawFunctionCall, { projectId, language });

        if (result.success) {
          useEditCardStore.getState().applySessionResult(
            sessionId,
            normalized.id,
            result,
            'Applied',
            `${getFunctionDisplayName(normalized.functionName)} was successfully applied`
          );
        } else {
          LLMTaskManager.setSessionError(sessionId, `Function call failed: ${result.error || result.message}`);
          useEditCardStore.getState().applySessionResult(
            sessionId,
            normalized.id,
            result,
            'Apply Failed',
            `${getFunctionDisplayName(normalized.functionName)} failed: ${result.error || result.message}`
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        LLMTaskManager.setSessionError(sessionId, `Function call error: ${errorMessage}`);
        useEditCardStore.getState().setSessionApplyError(sessionId, normalized.id, errorMessage);
      }
    };
  };

  // Create reject handler factory
  const createRejectHandler = (normalized: NormalizedFunctionCall) => {
    return async () => {
      useEditCardStore.getState().rejectSessionCard(
        sessionId,
        normalized.id,
        `${getFunctionDisplayName(normalized.functionName)} was rejected by user`
      );
    };
  };

  // Build cards with 'validating' status
  const validatingCards = buildEditCards(rawCalls, {
    createApplyHandler,
    createRejectHandler,
    initialStatus: 'validating',
  });

  store.setCardsForSession(sessionId, validatingCards);

  // Run async validation
  const normalized: NormalizedFunctionCall[] = rawCalls.map(fc => normalizeFunctionCall(fc));
  const validationResults = await validate(normalized);

  // Update cards with validation results
  const finalCards = applyValidationResults(validatingCards, validationResults);
  store.setCardsForSession(sessionId, finalCards);

  // Auto-confirm when ALL items fail validation
  const allFailed = finalCards.every(card =>
    card.functionCall?.status === 'failed' &&
    card.functionCall?.failureType === 'validation'
  );

  if (allFailed && finalCards.length > 0) {
    store.confirmSession(sessionId);
  }
}

/**
 * Apply all cards for a session (batch confirm)
 */
export async function batchConfirmSession(
  sessionId: string,
  selections: Record<string, boolean>,
  config: { projectId: string; language: string }
): Promise<void> {
  const { projectId, language } = config;
  const store = useEditCardStore.getState();
  const cards = store.getCardsForSession(sessionId);
  if (cards.length === 0) return;

  const storeActions = createStoreActions(useUnifiedObjectStore.getState());
  const applicator = new UnifiedApplicator({ store: storeActions });

  for (const card of cards) {
    // Skip cards with validation failures
    if (card.functionCall?.status === 'failed' && card.functionCall?.failureType === 'validation') continue;

    const isSelected = selections[card.id] ?? true;

    if (isSelected && card.functionCall) {
      const rawFunctionCall: RawFunctionCall = {
        id: card.functionCall.id,
        function_name: card.functionCall.functionName,
        arguments: card.functionCall.arguments,
      };

      try {
        const result = await applicator.apply(rawFunctionCall, { projectId, language });
        store.applySessionResult(sessionId, card.id, result, result.success ? 'Applied' : 'Apply Failed', result.message);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        store.setSessionApplyError(sessionId, card.id, errorMessage);
      }
    } else {
      const functionName = card.functionCall?.functionName ?? 'Unknown';
      store.rejectSessionCard(sessionId, card.id, `User rejected: ${getFunctionDisplayName(functionName)}`);
    }
  }

  store.confirmSession(sessionId);
}

// ============================================================================
// REACT HOOK (for use in React components)
// ============================================================================

/**
 * Common hook for function call handling
 *
 * Provides a unified interface for:
 * - Building EditCards from function calls
 * - Running async validation
 * - Creating apply/reject handlers
 * - Batch confirmation
 * - Streaming progress tracking
 */
export function useFunctionCallHandlers(
  config: UseFunctionCallHandlersConfig
): UseFunctionCallHandlersReturn {
  const { projectId, language, storageMode, onUpdateStatus, getSessionId } = config;

  // Create applicator with memoized store actions
  const applicator = useMemo(() => {
    const storeActions = createStoreActions(useUnifiedObjectStore.getState());
    return new UnifiedApplicator({ store: storeActions });
  }, []);

  // Active streaming function calls
  const activeFunctionCallsRef = useRef<Record<string, FunctionCallProgress[]>>({});
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, FunctionCallProgress[]>>({});

  // EditCard store access
  const cardsByMessage = useEditCardStore(state => state.cardsByMessage);
  const cardsBySession = useEditCardStore(state => state.cardsBySession);

  // Convert Map to Record for state
  const editCards = useMemo(() => {
    const record: Record<string, EditCard[]> = {};
    const sourceMap = storageMode === 'message' ? cardsByMessage : cardsBySession;
    sourceMap.forEach((cardMap, key) => {
      record[key] = Array.from(cardMap.values());
    });
    return record;
  }, [storageMode, cardsByMessage, cardsBySession]);

  // ============================================================================
  // Storage Mode Helpers
  // ============================================================================

  const getCards = useCallback((key: string): EditCard[] => {
    const store = useEditCardStore.getState();
    return storageMode === 'message'
      ? store.getCardsForMessage(key)
      : store.getCardsForSession(key);
  }, [storageMode]);

  const setCards = useCallback((key: string, cards: EditCard[]) => {
    const store = useEditCardStore.getState();
    if (storageMode === 'message') {
      store.setCardsForMessage(key, cards);
    } else {
      store.setCardsForSession(key, cards);
    }
  }, [storageMode]);

  const applyResult = useCallback((
    key: string,
    cardId: string,
    result: any,
    newTitle?: string,
    newDescription?: string
  ) => {
    const store = useEditCardStore.getState();
    if (storageMode === 'message') {
      store.applyResult(key, cardId, result, newTitle, newDescription);
    } else {
      store.applySessionResult(key, cardId, result, newTitle, newDescription);
    }
  }, [storageMode]);

  const rejectCard = useCallback((key: string, cardId: string, message?: string) => {
    const store = useEditCardStore.getState();
    if (storageMode === 'message') {
      store.rejectCard(key, cardId, message);
    } else {
      store.rejectSessionCard(key, cardId, message);
    }
  }, [storageMode]);

  const setApplyError = useCallback((key: string, cardId: string, error: string) => {
    const store = useEditCardStore.getState();
    if (storageMode === 'message') {
      store.setApplyError(key, cardId, error);
    } else {
      store.setSessionApplyError(key, cardId, error);
    }
  }, [storageMode]);

  const confirmKey = useCallback((key: string) => {
    const store = useEditCardStore.getState();
    if (storageMode === 'message') {
      store.confirmMessage(key);
    } else {
      store.confirmSession(key);
    }
  }, [storageMode]);

  const isConfirmed = useCallback((key: string): boolean => {
    const store = useEditCardStore.getState();
    return storageMode === 'message'
      ? store.isMessageConfirmed(key)
      : store.isSessionConfirmed(key);
  }, [storageMode]);

  // ============================================================================
  // Apply Handler
  // ============================================================================

  const createApplyHandler = useCallback(
    (storageKey: string, functionCall: FunctionCallMetadata) => {
      return async () => {
        try {
          const rawFunctionCall: RawFunctionCall = {
            id: functionCall.id,
            function_name: functionCall.function_name,
            arguments: functionCall.arguments,
          };

          // Re-validate before Apply (handles data changes since streaming)
          const normalized = normalizeFunctionCall(rawFunctionCall);
          const validationResults = await validate([normalized]);
          const validationResult = validationResults.get(normalized.id);

          if (validationResult && !validationResult.valid) {
            console.error('Pre-apply validation failed:', validationResult.error);

            onUpdateStatus?.(storageKey, functionCall.id, 'failed', {
              reason: validationResult.error,
              failureType: 'validation',
            });

            applyResult(
              storageKey,
              functionCall.id,
              { success: false, message: 'Validation failed', error: validationResult.error },
              'Validation Failed',
              `${getFunctionDisplayName(functionCall.function_name)}: ${validationResult.error}`
            );
            return;
          }

          // Validation passed - execute the function call
          const result = await applicator.apply(rawFunctionCall, {
            projectId,
            language,
          });

          if (result.success) {
            onUpdateStatus?.(storageKey, functionCall.id, 'accepted', { result });

            applyResult(
              storageKey,
              functionCall.id,
              result,
              'Applied by User',
              `${getFunctionDisplayName(functionCall.function_name)} was successfully applied`
            );
          } else {
            console.error('Failed to apply function call:', result.error || result.message);

            // Propagate error to toast via session
            const sessionId = getSessionId?.(storageKey);
            if (sessionId) {
              LLMTaskManager.setSessionError(sessionId, `Function call failed: ${result.error || result.message}`);
            }

            onUpdateStatus?.(storageKey, functionCall.id, 'failed', {
              result,
              reason: result.error,
              failureType: 'execution',
            });

            applyResult(
              storageKey,
              functionCall.id,
              result,
              'Apply Failed',
              `${getFunctionDisplayName(functionCall.function_name)} failed: ${result.error || result.message}`
            );
          }
        } catch (error) {
          console.error('Error applying function call:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Propagate error to toast via session
          const sessionId = getSessionId?.(storageKey);
          if (sessionId) {
            LLMTaskManager.setSessionError(sessionId, `Function call error: ${errorMessage}`);
          }

          onUpdateStatus?.(storageKey, functionCall.id, 'failed', {
            reason: errorMessage,
            failureType: 'execution',
          });

          setApplyError(storageKey, functionCall.id, errorMessage);
        }
      };
    },
    [projectId, language, applicator, onUpdateStatus, getSessionId, applyResult, setApplyError]
  );

  // ============================================================================
  // Reject Handler
  // ============================================================================

  const createRejectHandler = useCallback(
    (storageKey: string, functionCall: FunctionCallMetadata) => {
      return async (reason?: string) => {
        onUpdateStatus?.(storageKey, functionCall.id, 'rejected', { reason });

        rejectCard(
          storageKey,
          functionCall.id,
          `${getFunctionDisplayName(functionCall.function_name)} was rejected by user`
        );
      };
    },
    [onUpdateStatus, rejectCard]
  );

  // ============================================================================
  // Handle Function Calls
  // ============================================================================

  const handleFunctionCalls = useCallback(
    async (storageKey: string, functionCalls: FunctionCallMetadata[]) => {
      const rawCalls: RawFunctionCall[] = functionCalls.map(fc => ({
        id: fc.id,
        function_name: fc.function_name,
        arguments: fc.arguments,
      }));

      // Check if any function calls have existing status (restored from backend)
      const hasExistingStatus = functionCalls.some(fc => fc.status && fc.status !== 'pending');

      if (hasExistingStatus) {
        // Restoration path: use existing status from backend
        const cards = buildEditCards(rawCalls, {
          createApplyHandler: (normalized) => {
            const original = functionCalls.find(fc => fc.id === normalized.id);
            if (!original) return () => {};
            return createApplyHandler(storageKey, original);
          },
          createRejectHandler: (normalized) => {
            const original = functionCalls.find(fc => fc.id === normalized.id);
            if (!original) return () => {};
            return createRejectHandler(storageKey, original);
          },
        });

        // Restore applied status from original function calls
        const restoredCards: EditCard[] = cards.map(card => {
          const original = functionCalls.find(fc => fc.id === card.id);
          if (original) {
            return {
              ...card,
              functionCall: {
                ...card.functionCall,
                status: original.status,
                reason: original.reason,
                failureType: original.failureType,
                result: original.result,
                acceptedAt: original.acceptedAt,
              },
            };
          }
          return card;
        });

        setCards(storageKey, restoredCards);
      } else {
        // New function calls path: run async validation

        // 1. Create cards with 'validating' status immediately for UI feedback
        const validatingCards = buildEditCards(rawCalls, {
          createApplyHandler: (normalized) => {
            const original = functionCalls.find(fc => fc.id === normalized.id);
            if (!original) return () => {};
            return createApplyHandler(storageKey, original);
          },
          createRejectHandler: (normalized) => {
            const original = functionCalls.find(fc => fc.id === normalized.id);
            if (!original) return () => {};
            return createRejectHandler(storageKey, original);
          },
          initialStatus: 'validating',
        });

        setCards(storageKey, validatingCards);

        // 2. Run async validation
        const normalized: NormalizedFunctionCall[] = rawCalls.map(fc => normalizeFunctionCall(fc));
        const validationResults = await validate(normalized);

        // 3. Update cards with validation results
        const finalCards = applyValidationResults(validatingCards, validationResults);
        setCards(storageKey, finalCards);

        // 4. Sync validation failures to backend immediately
        validationResults.forEach((result, fcId) => {
          if (!result.valid) {
            onUpdateStatus?.(storageKey, fcId, 'failed', {
              reason: result.error,
              failureType: 'validation',
            });
          }
        });

        // 5. Auto-confirm when ALL items fail validation
        const allFailed = finalCards.every(card =>
          card.functionCall?.status === 'failed' &&
          card.functionCall?.failureType === 'validation'
        );

        if (allFailed && finalCards.length > 0) {
          confirmKey(storageKey);
        }
      }

      // Clear active function calls for this key
      delete activeFunctionCallsRef.current[storageKey];
      setActiveFunctionCalls({ ...activeFunctionCallsRef.current });
    },
    [createApplyHandler, createRejectHandler, setCards, confirmKey, onUpdateStatus]
  );

  // ============================================================================
  // Batch Confirm
  // ============================================================================

  const handleBatchConfirm = useCallback(
    async (storageKey: string, selections: Record<string, boolean>) => {
      const cards = getCards(storageKey);
      if (cards.length === 0) return;

      for (const card of cards) {
        // Skip cards with validation failures
        if (card.functionCall?.status === 'failed' && card.functionCall?.failureType === 'validation') continue;

        const isSelected = selections[card.id] ?? true;

        if (isSelected) {
          if (card.functionCall) {
            const rawFunctionCall: RawFunctionCall = {
              id: card.functionCall.id,
              function_name: card.functionCall.functionName,
              arguments: card.functionCall.arguments,
            };

            try {
              const result = await applicator.apply(rawFunctionCall, {
                projectId,
                language,
              });

              if (result.success) {
                onUpdateStatus?.(storageKey, card.id, 'accepted', { result });
                applyResult(storageKey, card.id, result, 'Applied', result.message);
              } else {
                console.error('Function call failed:', card.functionCall.functionName, result.error || result.message);
                onUpdateStatus?.(storageKey, card.id, 'failed', {
                  result,
                  reason: result.error,
                  failureType: 'execution',
                });
                applyResult(storageKey, card.id, result, 'Apply Failed', result.error || result.message);
              }
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : 'Unknown error';
              console.error('Error applying function call in batch:', errorMessage);
              setApplyError(storageKey, card.id, errorMessage);
            }
          }
        } else {
          const functionName = card.functionCall?.functionName ?? 'Unknown';

          onUpdateStatus?.(storageKey, card.id, 'rejected');
          rejectCard(storageKey, card.id, `User rejected: ${getFunctionDisplayName(functionName)}`);
        }
      }

      confirmKey(storageKey);
    },
    [projectId, language, applicator, getCards, applyResult, rejectCard, setApplyError, confirmKey, onUpdateStatus]
  );

  // ============================================================================
  // Function Call Progress
  // ============================================================================

  const handleFunctionCallProgress = useCallback(
    (storageKey: string, progressList: FunctionCallProgress[]) => {
      if (progressList.length === 0) return;

      const current = activeFunctionCallsRef.current[storageKey] || [];

      progressList.forEach(progress => {
        const existingIndex = current.findIndex(item => item.draft.index === progress.draft.index);
        if (existingIndex === -1) {
          current.push(progress);
        } else {
          current[existingIndex] = progress;
        }
      });

      activeFunctionCallsRef.current[storageKey] = current;
      setActiveFunctionCalls({ ...activeFunctionCallsRef.current });
    },
    []
  );

  // ============================================================================
  // Set Edit Cards (for restoration)
  // ============================================================================

  const setEditCards = useCallback(
    (cards: Record<string, EditCard[]>) => {
      const store = useEditCardStore.getState();
      Object.entries(cards).forEach(([key, keyCards]) => {
        if (storageMode === 'message') {
          store.setCardsForMessage(key, keyCards);
        } else {
          store.setCardsForSession(key, keyCards);
        }
      });
    },
    [storageMode]
  );

  // ============================================================================
  // Set Confirmed Keys (for restoration)
  // ============================================================================

  const setConfirmedKeys = useCallback(
    (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
      const store = useEditCardStore.getState();
      const sourceMap = storageMode === 'message' ? store.cardsByMessage : store.cardsBySession;

      const current: Record<string, boolean> = {};
      sourceMap.forEach((_cards, key) => {
        current[key] = storageMode === 'message'
          ? store.isMessageConfirmed(key)
          : store.isSessionConfirmed(key);
      });

      const updated = updater(current);

      Object.entries(updated).forEach(([key, isConf]) => {
        if (isConf) {
          if (storageMode === 'message') {
            store.confirmMessage(key);
          } else {
            store.confirmSession(key);
          }
        }
      });
    },
    [storageMode]
  );

  // ============================================================================
  // Clear Cards
  // ============================================================================

  const clearCards = useCallback(
    (key: string) => {
      const store = useEditCardStore.getState();
      if (storageMode === 'message') {
        store.clearMessage(key);
      } else {
        store.clearSession(key);
      }
    },
    [storageMode]
  );

  // ============================================================================
  // Return
  // ============================================================================

  return {
    state: {
      editCards,
      activeFunctionCalls,
    },
    actions: {
      handleFunctionCalls,
      handleFunctionCallProgress,
      createApplyHandler,
      createRejectHandler,
      handleBatchConfirm,
      isConfirmed,
      setEditCards,
      setConfirmedKeys,
      clearCards,
    },
  };
}

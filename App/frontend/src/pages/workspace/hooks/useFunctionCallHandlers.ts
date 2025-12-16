import { useState, useCallback, useRef } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useUnifiedObjectStore, useStoryObjects } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { FunctionCallApplicator } from '../../../chat/utils/functionCallApplicator';
import { FunctionCallService } from '../services/FunctionCallService';
import type { FunctionCallMetadata, FunctionCallResultSummary, FunctionCallProgress } from '../../../llm/requestTypes';
import type { EditCard } from '../../../chat/types';

export function useFunctionCallHandlers(
  projectId: string | undefined
) {
  const { updateMessageFunctionCalls, updateFunctionCallStatus, getSelectedChatId } = useChatStore();
  const unifiedStore = useUnifiedObjectStore();
  const { showError } = useErrorStore();
  const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);
  const storyObjects = useStoryObjects(projectId, mainLanguage);

  const [messageEditCards, setMessageEditCards] = useState<Record<string, EditCard[]>>({});
  const [functionCallApplicator] = useState(() => new FunctionCallApplicator(unifiedStore));
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, FunctionCallProgress[]>>({});
  const [pendingFunctionCallResults, setPendingFunctionCallResults] = useState<FunctionCallResultSummary[]>([]);
  const [confirmedMessages, setConfirmedMessages] = useState<Record<string, boolean>>({});

  // Store function calls by message ID for batch operations
  const functionCallsByMessage = useRef<Record<string, FunctionCallMetadata[]>>({});

  const getActiveChatId = useCallback(
    () => (projectId ? getSelectedChatId(projectId) : undefined),
    [projectId, getSelectedChatId]
  );

  const createFunctionCallApplyHandler = useCallback(
    (messageId: string, functionCall: FunctionCallMetadata) => {
      return async () => {
        if (!projectId) return;
        const chatId = getActiveChatId();
        if (!chatId) return;

        try {
          const result = await functionCallApplicator.applyFunctionCall(projectId, functionCall);

          if (result.success) {
            updateFunctionCallStatus(projectId, chatId, messageId, functionCall.id, true, result, undefined, result.message);

            setMessageEditCards(prev => ({
              ...prev,
              [messageId]: prev[messageId]?.map(card =>
                card.id === functionCall.id
                  ? {
                      ...card,
                      isApplied: true,
                      appliedAt: new Date(),
                      title: 'Applied by User',
                      description: `${FunctionCallService.getFunctionDisplayName(functionCall.function_name)} was successfully applied`
                    }
                  : card
              ) || []
            }));

            setPendingFunctionCallResults(prev => [...prev,
              {
                functionCallId: functionCall.id,
                functionName: functionCall.function_name,
                success: true,
                resultMessage: result.message,
                appliedAt: new Date()
              }
            ]);
          } else {
            console.error('Failed to apply function call:', result.error || result.message);
            showError('Function Call Failed', `Failed to apply changes: ${result.error || result.message}`);

            updateFunctionCallStatus(projectId, chatId, messageId, functionCall.id, false, result, result.error, result.error || result.message);

            setPendingFunctionCallResults(prev => [...prev,
              {
                functionCallId: functionCall.id,
                functionName: functionCall.function_name,
                success: false,
                resultMessage: result.error || result.message,
                appliedAt: new Date()
              }
            ]);

            setMessageEditCards(prev => ({
              ...prev,
              [messageId]: prev[messageId]?.map(card =>
                card.id === functionCall.id
                  ? {
                      ...card,
                      isApplied: true,
                      appliedAt: new Date(),
                      title: 'Apply Failed',
                      description: `${FunctionCallService.getFunctionDisplayName(functionCall.function_name)} failed: ${result.error || result.message}`
                    }
                  : card
              ) || []
            }));
          }
        } catch (error) {
          console.error('Error applying function call:', error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Show error modal
          showError('Function Call Error', `Failed to apply ${FunctionCallService.getFunctionDisplayName(functionCall.function_name)}: ${errorMessage}`);

          // Update chat store status (mark as not applied due to error)
          const chatIdForError = getActiveChatId();
          if (chatIdForError) {
            updateFunctionCallStatus(projectId, chatIdForError, messageId, functionCall.id, false, undefined, errorMessage, errorMessage);
          }

          // Update card with error but DON'T mark as applied - keep pending
          setMessageEditCards(prev => ({
            ...prev,
            [messageId]: prev[messageId]?.map(card =>
              card.id === functionCall.id
                ? {
                    ...card,
                    // Keep isApplied: false (or undefined) - card stays pending
                    applyError: errorMessage,
                  }
                : card
            ) || []
          }));

          // DON'T add to pendingFunctionCallResults - card stays pending for retry
        }
      };
    },
    [
      projectId,
      getActiveChatId,
      functionCallApplicator,
      updateFunctionCallStatus,
      setMessageEditCards,
      setPendingFunctionCallResults,
      showError,
    ]
  );

  const createFunctionCallRejectHandler = useCallback(
    (messageId: string, functionCall: FunctionCallMetadata) => {
      return async () => {
        if (!projectId) return;
        const chatId = getActiveChatId();
        if (!chatId) return;

        const rejectionMessage = 'User rejected the function call';
        updateFunctionCallStatus(projectId, chatId, messageId, functionCall.id, true, undefined, undefined, rejectionMessage);

        setMessageEditCards(prev => ({
          ...prev,
          [messageId]: prev[messageId]?.map(card =>
            card.id === functionCall.id
              ? {
                  ...card,
                  isApplied: true,
                  appliedAt: new Date(),
                  title: 'Rejected by User',
                  description: `${FunctionCallService.getFunctionDisplayName(functionCall.function_name)} was rejected by user`
                }
              : card
          ) || []
        }));

        setPendingFunctionCallResults(prev => [...prev,
          {
            functionCallId: functionCall.id,
            functionName: functionCall.function_name,
            success: false,
            resultMessage: rejectionMessage,
            appliedAt: new Date()
          }
        ]);
      };
    },
    [
      projectId,
      getActiveChatId,
      updateFunctionCallStatus,
      setMessageEditCards,
      setPendingFunctionCallResults,
    ]
  );

  const handleFunctionCalls = useCallback(
    (messageId: string, functionCalls: FunctionCallMetadata[]) => {
      if (!projectId) return;
      const chatId = getActiveChatId();
      if (!chatId) return;

      updateMessageFunctionCalls(projectId, chatId, messageId, functionCalls);

      // Store function calls for batch operations
      functionCallsByMessage.current[messageId] = functionCalls;

      const functionCallCards: EditCard[] = functionCalls.map(funcCall => {
        // Validate function call (check for missing required ID and ID existence)
        const validation = FunctionCallService.validateFunctionCall(
          funcCall.function_name,
          funcCall.arguments,
          storyObjects
        );

        return {
          id: funcCall.id,
          type: FunctionCallService.mapFunctionToEditType(funcCall.function_name),
          title: FunctionCallService.getFunctionCallTitle(funcCall.function_name),
          description: FunctionCallService.generateFunctionCallSummary(funcCall.function_name, funcCall.arguments),
          isApplied: funcCall.isApplied,
          isRejected: funcCall.isRejected,
          data: funcCall.arguments,
          appliedAt: funcCall.appliedAt,
          functionCall: funcCall, // Include reference to full function call
          onApply: createFunctionCallApplyHandler(messageId, funcCall),
          onReject: createFunctionCallRejectHandler(messageId, funcCall),
          validationError: validation.error, // Set validation error if invalid
        };
      });

      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: functionCallCards
      }));

      setActiveFunctionCalls(prev => {
        const updated = { ...prev };
        delete updated[messageId];
        return updated;
      });
    },
    [
      projectId,
      getActiveChatId,
      updateMessageFunctionCalls,
      createFunctionCallApplyHandler,
      createFunctionCallRejectHandler,
      setMessageEditCards,
      storyObjects,
    ]
  );

  /**
   * Handle batch confirmation of function calls with user selections
   * @param messageId - The message ID containing the function calls
   * @param selections - Map of function call ID to whether it should be applied (true) or rejected (false)
   */
  const handleBatchConfirm = useCallback(
    async (messageId: string, selections: Record<string, boolean>) => {
      if (!projectId) return;
      const chatId = getActiveChatId();
      if (!chatId) return;

      // Get function calls from ref first, fallback to extracting from cards
      let functionCalls = functionCallsByMessage.current[messageId];
      if (!functionCalls || functionCalls.length === 0) {
        // Fallback: extract function calls from the edit cards (for restored cards)
        const cards = messageEditCards[messageId];
        if (cards && cards.length > 0) {
          functionCalls = cards
            .filter(card => card.functionCall)
            .map(card => card.functionCall!);
        }
      }
      if (!functionCalls || functionCalls.length === 0) return;

      const results: { cardId: string; success: boolean; isRejected: boolean; message: string; hasError?: boolean }[] = [];
      const cards = messageEditCards[messageId] || [];

      // Process each function call based on selection
      for (const funcCall of functionCalls) {
        const card = cards.find(c => c.id === funcCall.id);
        const isSelected = selections[funcCall.id] ?? true; // Default to selected if not specified

        // Skip cards with validation errors - they cannot be applied
        if (card?.validationError) {
          continue;
        }

        if (isSelected) {
          // Apply the function call
          try {
            const result = await functionCallApplicator.applyFunctionCall(projectId, funcCall);

            if (result.success) {
              updateFunctionCallStatus(
                projectId, chatId, messageId, funcCall.id,
                true, result, undefined, result.message, false
              );
              results.push({
                cardId: funcCall.id,
                success: true,
                isRejected: false,
                message: result.message
              });

              setPendingFunctionCallResults(prev => [...prev, {
                functionCallId: funcCall.id,
                functionName: funcCall.function_name,
                success: true,
                isRejected: false,
                resultMessage: result.message,
                appliedAt: new Date()
              }]);
            } else {
              // Apply failed but not an exception - still mark as processed with error
              updateFunctionCallStatus(
                projectId, chatId, messageId, funcCall.id,
                true, result, result.error, result.error || result.message, false
              );
              results.push({
                cardId: funcCall.id,
                success: false,
                isRejected: false,
                message: result.error || result.message
              });

              setPendingFunctionCallResults(prev => [...prev, {
                functionCallId: funcCall.id,
                functionName: funcCall.function_name,
                success: false,
                isRejected: false,
                resultMessage: result.error || result.message,
                appliedAt: new Date()
              }]);
            }
          } catch (error) {
            // Exception during apply - keep card pending with error
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error('Error applying function call in batch:', errorMessage);

            // Show error modal for the failed operation
            showError('Function Call Error', `Failed to apply ${FunctionCallService.getFunctionDisplayName(funcCall.function_name)}: ${errorMessage}`);

            // Mark this card as having an error but NOT applied
            results.push({
              cardId: funcCall.id,
              success: false,
              isRejected: false,
              message: errorMessage,
              hasError: true, // Flag to indicate this should stay pending
            });
          }
        } else {
          // Reject the function call
          const rejectionMessage = `User rejected: ${FunctionCallService.getFunctionDisplayName(funcCall.function_name)}`;
          updateFunctionCallStatus(
            projectId, chatId, messageId, funcCall.id,
            true, undefined, undefined, rejectionMessage, true // isRejected = true
          );
          results.push({
            cardId: funcCall.id,
            success: false,
            isRejected: true,
            message: rejectionMessage
          });

          setPendingFunctionCallResults(prev => [...prev, {
            functionCallId: funcCall.id,
            functionName: funcCall.function_name,
            success: false,
            isRejected: true,
            resultMessage: rejectionMessage,
            appliedAt: new Date()
          }]);
        }
      }

      // Update edit cards with results
      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: prev[messageId]?.map(card => {
          const result = results.find(r => r.cardId === card.id);
          if (!result) return card;

          // If hasError flag is set, keep card pending with applyError
          if (result.hasError) {
            return {
              ...card,
              // Keep isApplied: false - card stays pending
              applyError: result.message,
            };
          }

          return {
            ...card,
            isApplied: true,
            isRejected: result.isRejected,
            appliedAt: new Date(),
            title: result.isRejected
              ? 'Rejected by User'
              : result.success
                ? 'Applied'
                : 'Apply Failed',
            description: result.message
          };
        }) || []
      }));

      // Mark message as confirmed
      setConfirmedMessages(prev => ({
        ...prev,
        [messageId]: true
      }));
    },
    [
      projectId,
      getActiveChatId,
      functionCallApplicator,
      updateFunctionCallStatus,
      setPendingFunctionCallResults,
      setMessageEditCards,
      setConfirmedMessages,
      messageEditCards, // Added for fallback extraction of function calls
      showError,
    ]
  );

  /**
   * Check if all function calls in a message have been confirmed
   */
  const isMessageConfirmed = useCallback(
    (messageId: string): boolean => {
      return confirmedMessages[messageId] ?? false;
    },
    [confirmedMessages]
  );

  const handleFunctionCallProgress = useCallback(
    (messageId: string, progressList: FunctionCallProgress[]) => {
      if (progressList.length === 0) {
        return;
      }

      setActiveFunctionCalls(prev => {
        const current = prev[messageId] ? [...prev[messageId]] : [];
        progressList.forEach(progress => {
          const existingIndex = current.findIndex(item => item.draft.index === progress.draft.index);
          if (existingIndex === -1) {
            current.push(progress);
          } else {
            current[existingIndex] = progress;
          }
        });

        return {
          ...prev,
          [messageId]: current
        };
      });
    },
    []
  );

  return {
    messageEditCards,
    setMessageEditCards,
    activeFunctionCalls,
    pendingFunctionCallResults,
    setPendingFunctionCallResults,
    handleFunctionCalls,
    handleFunctionCallProgress,
    handleBatchConfirm,
    isMessageConfirmed,
    setConfirmedMessages,
    createFunctionCallApplyHandler,
    createFunctionCallRejectHandler,
  };
}

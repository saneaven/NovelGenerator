import { useState, useCallback } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useStoryObjectStore } from '../../../store/storyObjectStore';
import { useErrorStore } from '../../../store/errorStore';
import { FunctionCallApplicator } from '../../../chat/utils/functionCallApplicator';
import { FunctionCallService } from '../services/FunctionCallService';
import type { FunctionCallMetadata, FunctionCallResultSummary } from '../../../llm_request/types';
import type { EditCard } from '../../../chat/types';

export function useFunctionCallHandlers(
  projectId: string | undefined
) {
  const { updateMessageFunctionCalls, updateFunctionCallStatus, getSelectedChatId } = useChatStore();
  const storyObjectStore = useStoryObjectStore();
  const { showError } = useErrorStore();

  const [messageEditCards, setMessageEditCards] = useState<Record<string, EditCard[]>>({});
  const [functionCallApplicator] = useState(() => new FunctionCallApplicator(storyObjectStore));
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, any[]>>({});
  const [pendingFunctionCallResults, setPendingFunctionCallResults] = useState<FunctionCallResultSummary[]>([]);

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
          showError('Function Call Error', 'An error occurred while applying changes. Please try again.');

          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const chatIdForError = getActiveChatId();
          if (chatIdForError) {
            updateFunctionCallStatus(projectId, chatIdForError, messageId, functionCall.id, false, undefined, errorMessage, errorMessage);
          }

          setPendingFunctionCallResults(prev => [...prev,
            {
              functionCallId: functionCall.id,
              functionName: functionCall.function_name,
              success: false,
              resultMessage: errorMessage,
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
                    title: 'Apply Error',
                    description: `${FunctionCallService.getFunctionDisplayName(functionCall.function_name)} error: ${errorMessage}`
                  }
                : card
            ) || []
          }));
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

      const functionCallCards = functionCalls.map(funcCall => ({
        id: funcCall.id,
        type: FunctionCallService.mapFunctionToEditType(funcCall.function_name),
        title: FunctionCallService.getFunctionCallTitle(funcCall.function_name),
        description: FunctionCallService.generateFunctionCallSummary(funcCall.function_name, funcCall.arguments),
        isApplied: funcCall.isApplied,
        data: funcCall.arguments,
        appliedAt: funcCall.appliedAt,
        onApply: createFunctionCallApplyHandler(messageId, funcCall),
        onReject: createFunctionCallRejectHandler(messageId, funcCall)
      }));

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
    ]
  );

  const handleFunctionCallsDetected = useCallback(
    (messageId: string, functionCalls: any[]) => {
      setActiveFunctionCalls(prev => ({
        ...prev,
        [messageId]: functionCalls
      }));
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
    handleFunctionCallsDetected,
    createFunctionCallApplyHandler,
    createFunctionCallRejectHandler,
  };
}

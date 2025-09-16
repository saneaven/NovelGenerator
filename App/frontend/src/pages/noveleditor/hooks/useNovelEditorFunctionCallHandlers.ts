import { useState } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useNovelStore } from '../../../store/novelStore';
import { useErrorStore } from '../../../store/errorStore';
import { NovelEditorFunctionCallApplicator } from '../services/NovelEditorFunctionCallApplicator';
import { NovelEditorFunctionCallService } from '../services/NovelEditorFunctionCallService';
import type { FunctionCallMetadata, FunctionCallResultSummary } from '../../../llm_request/types';
import type { EditCard } from '../../../chat/types';

export function useNovelEditorFunctionCallHandlers(
  projectId: string | undefined
) {
  const { updateMessageFunctionCalls, updateFunctionCallStatus } = useChatStore();
  const novelStore = useNovelStore();
  const { showError } = useErrorStore();

  const [messageEditCards, setMessageEditCards] = useState<Record<string, EditCard[]>>({});
  const [functionCallApplicator] = useState(() => new NovelEditorFunctionCallApplicator({
    updateChapterContent: novelStore.updateChapterContent
  }));
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, any[]>>({});
  const [pendingFunctionCallResults, setPendingFunctionCallResults] = useState<FunctionCallResultSummary[]>([]);

  const createFunctionCallApplyHandler = (messageId: string, functionCall: FunctionCallMetadata) => {
    return async () => {
      if (!projectId) return;

      try {
        const result = await functionCallApplicator.applyFunctionCall(projectId, functionCall);

        if (result.success) {
          updateFunctionCallStatus(projectId, messageId, functionCall.id, true, result, undefined, result.message);

          setMessageEditCards(prev => ({
            ...prev,
            [messageId]: prev[messageId]?.map(card =>
              card.id === functionCall.id
                ? {
                    ...card,
                    isApplied: true,
                    appliedAt: new Date(),
                    title: '✅ Applied by User',
                    description: `${NovelEditorFunctionCallService.getFunctionDisplayName(functionCall.function_name)} was successfully applied`
                  }
                : card
            ) || []
          }));

          // Add to pending function call results for SystemTagManager
          setPendingFunctionCallResults(prev => [...prev, {
            functionCallId: functionCall.id,
            functionName: functionCall.function_name,
            success: true,
            resultMessage: result.message,
            appliedAt: new Date()
          }]);
        } else {
          console.error('Failed to apply function call:', result.error || result.message);
          showError('Function Call Failed', `Failed to apply changes: ${result.error || result.message}`);

          updateFunctionCallStatus(projectId, messageId, functionCall.id, false, result, result.error, result.error || result.message);

          // Add failed result to pending function call results
          setPendingFunctionCallResults(prev => [...prev, {
            functionCallId: functionCall.id,
            functionName: functionCall.function_name,
            success: false,
            resultMessage: result.error || result.message,
            appliedAt: new Date()
          }]);

          setMessageEditCards(prev => ({
            ...prev,
            [messageId]: prev[messageId]?.map(card =>
              card.id === functionCall.id
                ? {
                    ...card,
                    isApplied: true,
                    appliedAt: new Date(),
                    title: '❌ Apply Failed',
                    description: `${NovelEditorFunctionCallService.getFunctionDisplayName(functionCall.function_name)} failed: ${result.error || result.message}`
                  }
                : card
            ) || []
          }));
        }
      } catch (error) {
        console.error('Error applying function call:', error);
        showError('Function Call Error', 'An error occurred while applying changes. Please try again.');

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        updateFunctionCallStatus(projectId, messageId, functionCall.id, false, undefined, errorMessage, errorMessage);

        // Add error result to pending function call results
        setPendingFunctionCallResults(prev => [...prev, {
          functionCallId: functionCall.id,
          functionName: functionCall.function_name,
          success: false,
          resultMessage: errorMessage,
          appliedAt: new Date()
        }]);

        setMessageEditCards(prev => ({
          ...prev,
          [messageId]: prev[messageId]?.map(card =>
            card.id === functionCall.id
              ? {
                  ...card,
                  isApplied: true,
                  appliedAt: new Date(),
                  title: '❌ Apply Error',
                  description: `${NovelEditorFunctionCallService.getFunctionDisplayName(functionCall.function_name)} error: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
              : card
          ) || []
        }));
      }
    };
  };

  const createFunctionCallRejectHandler = (messageId: string, functionCall: FunctionCallMetadata) => {
    return async () => {
      if (!projectId) return;

      const rejectionMessage = 'User rejected the function call';
      updateFunctionCallStatus(projectId, messageId, functionCall.id, true, undefined, undefined, rejectionMessage);

      setMessageEditCards(prev => ({
        ...prev,
        [messageId]: prev[messageId]?.map(card =>
          card.id === functionCall.id
            ? {
                ...card,
                isApplied: true,
                appliedAt: new Date(),
                title: '❌ Rejected by User',
                description: `${NovelEditorFunctionCallService.getFunctionDisplayName(functionCall.function_name)} was rejected by user`
              }
            : card
        ) || []
      }));

      // Add rejection to pending function call results
      setPendingFunctionCallResults(prev => [...prev, {
        functionCallId: functionCall.id,
        functionName: functionCall.function_name,
        success: false,
        resultMessage: rejectionMessage,
        appliedAt: new Date()
      }]);
    };
  };

  const handleFunctionCalls = (messageId: string, functionCalls: FunctionCallMetadata[]) => {
    console.log('useNovelEditorFunctionCallHandlers: handleFunctionCalls called', { messageId, functionCalls, projectId });
    if (!projectId) return;

    updateMessageFunctionCalls(projectId, messageId, functionCalls);

    const functionCallCards = functionCalls.map(funcCall => ({
      id: funcCall.id,
      type: NovelEditorFunctionCallService.mapFunctionToEditType(funcCall.function_name),
      title: NovelEditorFunctionCallService.getFunctionCallTitle(funcCall.function_name),
      description: NovelEditorFunctionCallService.generateFunctionCallSummary(funcCall.function_name, funcCall.arguments),
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
  };

  const handleFunctionCallsDetected = (messageId: string, functionCalls: any[]) => {
    setActiveFunctionCalls(prev => ({
      ...prev,
      [messageId]: functionCalls
    }));
  };

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
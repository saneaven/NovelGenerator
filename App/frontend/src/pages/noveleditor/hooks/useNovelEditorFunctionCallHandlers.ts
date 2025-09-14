import { useState } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useNovelStore } from '../../../store/novelStore';
import { useErrorStore } from '../../../store/errorStore';
import { NovelEditorFunctionCallApplicator } from '../services/NovelEditorFunctionCallApplicator';
import { NovelEditorFunctionCallService } from '../services/NovelEditorFunctionCallService';
import type { FunctionCallMetadata } from '../../../llm_request/types';
import type { EditCard } from '../../../chat/types';
import type { RuntimeProcessor } from '../../../chat/processors/RuntimeProcessor';

export function useNovelEditorFunctionCallHandlers(
  projectId: string | undefined,
  runtimeProcessor: RuntimeProcessor | null
) {
  const { updateMessageFunctionCalls, updateFunctionCallStatus } = useChatStore();
  const novelStore = useNovelStore();
  const { showError } = useErrorStore();

  const [messageEditCards, setMessageEditCards] = useState<Record<string, EditCard[]>>({});
  const [functionCallApplicator] = useState(() => new NovelEditorFunctionCallApplicator({
    updateChapterContent: novelStore.updateChapterContent
  }));
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, any[]>>({});
  const [pendingFunctionCallResults, setPendingFunctionCallResults] = useState<Array<{
    functionCall: FunctionCallMetadata;
    accepted: boolean;
    resultMessage: string;
  }>>([]);

  const createFunctionCallApplyHandler = (messageId: string, functionCall: FunctionCallMetadata) => {
    return async () => {
      if (!projectId) return;

      try {
        const result = await functionCallApplicator.applyFunctionCall(projectId, functionCall);

        if (result.success) {
          updateFunctionCallStatus(projectId, messageId, functionCall.id, true, result);

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

          setPendingFunctionCallResults(prev => [...prev, {
            functionCall,
            accepted: true,
            resultMessage: result.message
          }]);
        } else {
          console.error('Failed to apply function call:', result.error || result.message);
          showError('Function Call Failed', `Failed to apply changes: ${result.error || result.message}`);

          updateFunctionCallStatus(projectId, messageId, functionCall.id, false, result, result.error);

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

        updateFunctionCallStatus(projectId, messageId, functionCall.id, false, undefined, error instanceof Error ? error.message : 'Unknown error');

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

      updateFunctionCallStatus(projectId, messageId, functionCall.id, true);

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

      setPendingFunctionCallResults(prev => [...prev, {
        functionCall,
        accepted: false,
        resultMessage: 'User rejected the function call'
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
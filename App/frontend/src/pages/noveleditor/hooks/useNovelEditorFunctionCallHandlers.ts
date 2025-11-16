import { useState, useCallback, useMemo } from 'react';
import { useChatStore } from '../../../store/chatStore';
import { useNovelStore } from '../../../store/novelStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { NovelEditorFunctionCallApplicator } from '../services/NovelEditorFunctionCallApplicator';
import { NovelEditorFunctionCallService } from '../services/NovelEditorFunctionCallService';
import type { FunctionCallMetadata, FunctionCallResultSummary, FunctionCallProgress } from '../../../llm_request/types';
import type { EditCard } from '../../../chat/types';

export function useNovelEditorFunctionCallHandlers(
  projectId: string | undefined
) {
  const { updateMessageFunctionCalls, updateFunctionCallStatus, getSelectedChatId } = useChatStore();
  const { updateChapterContentForLanguage } = useNovelStore();
  const { settings } = useSettingsStore();
  const { showError } = useErrorStore();

  const [messageEditCards, setMessageEditCards] = useState<Record<string, EditCard[]>>({});

  const functionCallApplicator = useMemo(() => new NovelEditorFunctionCallApplicator({
    updateChapterContent: (projectId: string, chapterId: string, content: string, userRequest?: string) => {
      // AI-generated content should create new versions
      updateChapterContentForLanguage(projectId, chapterId, content, settings.primaryLanguage, userRequest, true);
    }
  }), [updateChapterContentForLanguage, settings.primaryLanguage]);
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, FunctionCallProgress[]>>({});
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
                      description: `${NovelEditorFunctionCallService.getFunctionDisplayName(functionCall.function_name)} was successfully applied`
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
            const failureMessage = result.error || result.message;
            console.error('Failed to apply function call:', failureMessage);
            showError('Function Call Failed', `Failed to apply changes: ${failureMessage}`);

            updateFunctionCallStatus(projectId, chatId, messageId, functionCall.id, false, result, result.error, failureMessage);

            setPendingFunctionCallResults(prev => [...prev,
              {
                functionCallId: functionCall.id,
                functionName: functionCall.function_name,
                success: false,
                resultMessage: failureMessage,
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
                      description: `${NovelEditorFunctionCallService.getFunctionDisplayName(functionCall.function_name)} failed: ${failureMessage}`
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
                    description: `${NovelEditorFunctionCallService.getFunctionDisplayName(functionCall.function_name)} error: ${errorMessage}`
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
                  description: `${NovelEditorFunctionCallService.getFunctionDisplayName(functionCall.function_name)} was rejected by user`
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
    createFunctionCallApplyHandler,
    createFunctionCallRejectHandler,
  };
}

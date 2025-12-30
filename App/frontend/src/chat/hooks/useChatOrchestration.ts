/**
 * Unified Chat Orchestration Hook
 *
 * Consolidates chat management, function call handling, and context management
 * into a single hook used by both Workspace and NovelEditor pages.
 *
 * Mode only affects systemPrompt template selection - all other behavior is identical.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatManager, type ChatManagerCallbacks } from '../processors/ChatManager';
import { DefaultDisplayProcessor } from '../processors/DisplayProcessor';
import { CHAT_FUNCTIONS } from '../../llm/schemas/chatFunctions';
import { LLMTaskManager } from '../../llm/LLMTaskManager';
import { useChatStore } from '../../store/chatStore';
import { useChatUIStore } from '../../store/chatUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { generateTempId } from '../../utils/tempId';
import {
  UnifiedApplicator,
  createStoreActions,
  useEditCardStore,
  buildEditCards,
  getFunctionDisplayName,
  type RawFunctionCall,
  type EditCard,
} from '../../functionCall';
import type { ChatMessage, FunctionCallMetadata, FunctionCallProgress, FunctionCallResultSummary } from '../../llm/requestTypes';
import type { ContentPart } from '../../api/types';
import type {
  ChatOrchestrationConfig,
  ChatOrchestrationReturn,
  FunctionCallState,
  FunctionCallHandlers,
  ContextIdState,
  ChatHandlersReturn,
} from './types';

/**
 * Unified chat orchestration hook
 *
 * Provides all chat-related functionality including:
 * - ChatManager instantiation and callbacks
 * - Function call handling (apply, reject, batch confirm)
 * - Context ID management (auto-select new objects)
 * - EditCard state management
 * - Chat interaction handlers (submit, edit, delete)
 */
export function useChatOrchestration(config: ChatOrchestrationConfig): ChatOrchestrationReturn {
  const { projectId, mode } = config;

  // ============================================================================
  // Store Access
  // ============================================================================

  const {
    addMessage,
    updateMessage,
    updateMessageContentLocal,
    updateMessageFunctionCalls,
    updateFunctionCallStatus,
    getMessages,
    getSelectedChatId,
    selectChat,
    deleteMessage,
    clearMessageTranslations,
  } = useChatStore();

  const unifiedStore = useUnifiedObjectStore();
  const settings = useSettingsStore(state => state.settings);
  const mainLanguage = settings.mainLanguage;
  const chatFunctionConfig = settings.functionConfigs.chat;
  const providerCredentials = settings.providerCredentials;

  // Chat UI actions (selected individually to avoid re-renders)
  const isLoading = useChatUIStore(state => state.isLoading);
  const clearInput = useChatUIStore(state => state.clearInput);
  const startEditing = useChatUIStore(state => state.startEditing);
  const updateEditContent = useChatUIStore(state => state.updateEditContent);
  const getEditing = useChatUIStore(state => state.getEditing);
  const cancelEditing = useChatUIStore(state => state.cancelEditing);
  const closeSidebar = useSidebarStore(state => state.closeSidebar);
  const getObjectsMissingMainLanguage = useUnifiedObjectStore(state => state.getObjectsMissingMainLanguage);

  // ============================================================================
  // Context ID Management
  // ============================================================================

  // Selected context IDs for chat - initialized with all project objects
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>(() => {
    return Object.keys(unifiedStore.objects)
      .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId);
  });

  // Track previous object IDs to auto-select newly created objects
  const prevObjectIdsRef = useRef<Set<string>>(new Set(selectedContextIds));

  // Ref to always get current selectedContextIds (avoid stale closure in ChatManager)
  const selectedContextIdsRef = useRef(selectedContextIds);
  selectedContextIdsRef.current = selectedContextIds;

  // Auto-select new objects when they're created during the session
  useEffect(() => {
    const currentIds = new Set(
      Object.keys(unifiedStore.objects)
        .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId)
    );

    // Find new IDs that weren't in the previous set
    const newIds = [...currentIds].filter(id => !prevObjectIdsRef.current.has(id));

    if (newIds.length > 0) {
      setSelectedContextIds(prev => [...new Set([...prev, ...newIds])]);
    }

    prevObjectIdsRef.current = currentIds;
  }, [unifiedStore.objects, projectId]);

  // Total count of all project objects
  const totalObjectCount = useMemo(() => {
    return Object.keys(unifiedStore.objects)
      .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId)
      .length;
  }, [unifiedStore.objects, projectId]);

  const contextIds: ContextIdState = {
    selectedContextIds,
    setSelectedContextIds,
    selectedContextIdsRef,
    totalObjectCount,
  };

  // ============================================================================
  // Function Call Handling
  // ============================================================================

  // EditCard store
  const cardsByMessage = useEditCardStore(state => state.cardsByMessage);

  // Convert Map to Record for backward compatibility
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

  // Pending function call results for next prompt
  const [pendingFunctionCallResults, setPendingFunctionCallResultsState] = useState<FunctionCallResultSummary[]>([]);
  const pendingResultsRef = useRef<FunctionCallResultSummary[]>([]);

  const addPendingResult = useCallback((result: FunctionCallResultSummary) => {
    pendingResultsRef.current.push(result);
    setPendingFunctionCallResultsState([...pendingResultsRef.current]);
  }, []);

  const setPendingFunctionCallResults = useCallback((results: FunctionCallResultSummary[]) => {
    pendingResultsRef.current = results;
    setPendingFunctionCallResultsState(results);
  }, []);

  const clearPendingResults = useCallback(() => {
    pendingResultsRef.current = [];
    setPendingFunctionCallResultsState([]);
  }, []);

  // Active streaming function calls
  const activeFunctionCallsRef = useRef<Record<string, FunctionCallProgress[]>>({});
  const [activeFunctionCalls, setActiveFunctionCalls] = useState<Record<string, FunctionCallProgress[]>>({});

  // Session tracking for error propagation to toast
  const messageSessionMap = useRef<Record<string, string>>({});

  const getActiveChatId = useCallback(
    () => (projectId ? getSelectedChatId(projectId) : undefined),
    [projectId, getSelectedChatId]
  );

  const registerSessionForMessage = useCallback(
    (messageId: string, sessionId: string) => {
      messageSessionMap.current[messageId] = sessionId;
    },
    []
  );

  // Create apply handler for a function call
  const createApplyHandler = useCallback(
    (messageId: string, functionCall: FunctionCallMetadata) => {
      return async () => {
        if (!projectId) return;
        const chatId = getActiveChatId();
        if (!chatId) return;

        try {
          const rawFunctionCall: RawFunctionCall = {
            id: functionCall.id,
            function_name: functionCall.function_name,
            arguments: functionCall.arguments,
          };

          const result = await applicator.apply(rawFunctionCall, {
            projectId,
            language: mainLanguage,
          });

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

            // Propagate error to toast via session
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

          // Propagate error to toast via session
          const sessionId = messageSessionMap.current[messageId];
          if (sessionId) {
            LLMTaskManager.setSessionError(sessionId, `Function call error: ${errorMessage}`);
          }

          const chatIdForError = getActiveChatId();
          if (chatIdForError) {
            updateFunctionCallStatus(projectId, chatIdForError, messageId, functionCall.id, false, undefined, errorMessage, errorMessage);
          }

          useEditCardStore.getState().setApplyError(messageId, functionCall.id, errorMessage);
        }
      };
    },
    [projectId, getActiveChatId, applicator, mainLanguage, updateFunctionCallStatus, addPendingResult]
  );

  // Create reject handler for a function call
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

  // Handle incoming function calls from LLM response
  const handleFunctionCalls = useCallback(
    (messageId: string, functionCalls: FunctionCallMetadata[]) => {
      if (!projectId) return;
      const chatId = getActiveChatId();
      if (!chatId) return;

      updateMessageFunctionCalls(projectId, chatId, messageId, functionCalls);

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

  // Handle batch confirmation
  const handleBatchConfirm = useCallback(
    async (messageId: string, selections: Record<string, boolean>) => {
      if (!projectId) return;
      const chatId = getActiveChatId();
      if (!chatId) return;

      const cardStore = useEditCardStore.getState();
      const cards = cardStore.getCardsForMessage(messageId);
      if (cards.length === 0) return;

      for (const card of cards) {
        if (card.validationError) continue;

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
                language: mainLanguage,
              });

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
              useEditCardStore.getState().setApplyError(messageId, card.id, errorMessage);
            }
          }
        } else {
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

      useEditCardStore.getState().confirmMessage(messageId);
    },
    [projectId, getActiveChatId, applicator, mainLanguage, updateFunctionCallStatus, addPendingResult]
  );

  // Check if message is confirmed
  const isMessageConfirmed = useCallback(
    (messageId: string): boolean => {
      return useEditCardStore.getState().isMessageConfirmed(messageId);
    },
    []
  );

  // Handle function call progress during streaming
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
      setActiveFunctionCalls({ ...activeFunctionCallsRef.current });
    },
    []
  );

  // Set message EditCards (for restoration)
  const setMessageEditCards = useCallback(
    (cards: Record<string, EditCard[]>) => {
      const store = useEditCardStore.getState();
      Object.entries(cards).forEach(([messageId, messageCards]) => {
        store.setCardsForMessage(messageId, messageCards);
      });
    },
    []
  );

  // Set confirmed messages (for restoration)
  const setConfirmedMessages = useCallback(
    (updater: (prev: Record<string, boolean>) => Record<string, boolean>) => {
      const store = useEditCardStore.getState();
      const current: Record<string, boolean> = {};
      store.cardsByMessage.forEach((_cards, messageId) => {
        current[messageId] = store.isMessageConfirmed(messageId);
      });

      const updated = updater(current);

      Object.entries(updated).forEach(([messageId, isConfirmed]) => {
        if (isConfirmed) {
          store.confirmMessage(messageId);
        }
      });
    },
    []
  );

  const functionCallState: FunctionCallState = {
    messageEditCards,
    activeFunctionCalls,
    pendingFunctionCallResults,
  };

  const functionCallHandlers: FunctionCallHandlers = {
    handleBatchConfirm,
    isMessageConfirmed,
    createApplyHandler,
    createRejectHandler,
    handleFunctionCalls,
    handleFunctionCallProgress,
    registerSessionForMessage,
    setPendingFunctionCallResults,
    clearPendingResults,
    setMessageEditCards,
    setConfirmedMessages,
  };

  // ============================================================================
  // ChatManager Setup
  // ============================================================================

  const abortControllerRef = useRef<AbortController | null>(null);

  const chatManagerCallbacks = useMemo<ChatManagerCallbacks>(() => ({
    onUpdateMessage: (projId, chatId, messageId, contentParts, language, thinking_details) => {
      updateMessageContentLocal(projId, chatId, messageId, contentParts, language, thinking_details);
    },
    onSyncMessageToBackend: async (projId, chatId, messageId, contentParts, language, thinking_details) => {
      await updateMessage(projId, chatId, messageId, contentParts, language, thinking_details);
    },
    onFunctionCalls: (_projId, _chatId, messageId, functionCalls, sessionId) => {
      // Register sessionId for this message so function call errors can update the toast
      if (sessionId) {
        registerSessionForMessage(messageId, sessionId);
      }
      handleFunctionCalls(messageId, functionCalls);
    },
    onAddMessage: async (projId, chatId, message, language) => {
      return await addMessage(projId, chatId, message, language);
    },
    onGetChatHistory: (projId, chatId, language) => getMessages(projId, chatId, language),
    onError: (error) => {
      // Legacy callback - errors are now shown inline via onErrorMessage
      console.error('Runtime processing error:', error);
    },
    onErrorMessage: (projId, chatId, messageId, errorMessage, language) => {
      // Append error content part to the message for inline display
      const messages = getMessages(projId, chatId, language);
      const message = messages.find(m => m.id === messageId);
      if (message) {
        const errorPart = { type: 'error' as const, text: errorMessage };
        const newParts = [...message.contentParts, errorPart];
        updateMessageContentLocal(projId, chatId, messageId, newParts, language);
      }
    },
    onFunctionCallProgress: (_projId, _chatId, messageId, progressEvents) => {
      handleFunctionCallProgress(messageId, progressEvents);
    },
  }), [updateMessageContentLocal, updateMessage, handleFunctionCalls, addMessage, getMessages, handleFunctionCallProgress, registerSessionForMessage]);

  const chatManager = useMemo(() => {
    const activeProjectId = projectId ?? '';
    if (!activeProjectId) return null;

    return new ChatManager(
      {
        projectId: activeProjectId,
        getIsLoading: () => useChatUIStore.getState().isLoading(activeProjectId),
        setIsLoading: (loading: boolean) => useChatUIStore.getState().setLoading(activeProjectId, loading),
        abortControllerRef,
        getActiveChatId: () => {
          if (!activeProjectId) return undefined;
          return getSelectedChatId(activeProjectId);
        },
        getConversationLanguage: () => mainLanguage,
        aiModel: chatFunctionConfig.model,
        temperature: chatFunctionConfig.temperature,
        provider: chatFunctionConfig.provider,
        providerConfig: providerCredentials[chatFunctionConfig.provider],
        functions: CHAT_FUNCTIONS,
        mode,
        enablePrefill: chatFunctionConfig.advanced.enablePrefill,
        thinkingMode: chatFunctionConfig.advanced.thinkingMode,
        thinkingConfig: chatFunctionConfig.advanced.thinkingConfig,
        retryConfig: settings.retryConfig,
        getPendingFunctionCallResults: () => pendingFunctionCallResults,
        getSelectedContextIds: () => selectedContextIdsRef.current,
      },
      chatManagerCallbacks
    );
  }, [
    projectId,
    mainLanguage,
    chatFunctionConfig,
    providerCredentials,
    getSelectedChatId,
    chatManagerCallbacks,
    settings.retryConfig,
    mode,
    pendingFunctionCallResults,
  ]);

  // ============================================================================
  // EditCard Restoration Effect
  // ============================================================================

  const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);

  // Get selected chat ID reactively to trigger effect when chat changes
  const selectedChatId = useChatStore(state =>
    projectId ? state.selectedChatByProject[projectId] : undefined
  );

  // Get message count reactively to trigger effect when messages are loaded
  const messageCount = useChatStore(state => {
    if (!projectId || !selectedChatId) return 0;
    const chat = state.chatsByProject[projectId]?.find(c => c.id === selectedChatId);
    return chat?.messages?.length ?? 0;
  });

  useEffect(() => {
    if (!projectId || !selectedChatId) return;

    const messages = getMessages(projectId, selectedChatId, mainLanguage);
    const restored: Record<string, EditCard[]> = {};
    const restoredConfirmed: Record<string, boolean> = {};

    messages.forEach(message => {
      const processed = displayProcessor.process(message as any, {
        projectId,
        mode,
      } as any);

      if (processed.editCards.length > 0) {
        const cards = processed.editCards.map(card => {
          if (message.role === 'assistant' && message.functionCalls) {
            const funcCall = message.functionCalls.find(fc => fc.id === card.id);
            if (funcCall) {
              return {
                ...card,
                appliedAt: funcCall.appliedAt,
                onApply: createApplyHandler(message.id, funcCall),
                onReject: createRejectHandler(message.id, funcCall),
              };
            }
          }
          return card;
        });
        restored[message.id] = cards;

        // Check if all function calls in this message have been applied/rejected
        const allProcessed = cards.every(card => card.isApplied || card.isRejected);
        if (allProcessed && cards.length > 0) {
          restoredConfirmed[message.id] = true;
        }
      }
    });

    setMessageEditCards(restored);
    setConfirmedMessages(() => restoredConfirmed);
  }, [projectId, selectedChatId, messageCount, getMessages, mainLanguage, mode, displayProcessor, createApplyHandler, createRejectHandler, setMessageEditCards, setConfirmedMessages]);

  // ============================================================================
  // Chat Handlers
  // ============================================================================

  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSelectChat = useCallback((chatId: string) => {
    if (!projectId) return;
    selectChat(projectId, chatId);
    closeSidebar(projectId);
  }, [projectId, selectChat, closeSidebar]);

  const handleSubmit = useCallback(async (e: React.FormEvent, input: string) => {
    e.preventDefault();
    if (!projectId || !chatManager) return;
    if (isLoading(projectId)) return;

    const chatId = getActiveChatId();
    if (!chatId) return;

    // Check for objects missing main language content
    const missingMainLanguageObjects = getObjectsMissingMainLanguage(projectId, mainLanguage);
    if (missingMainLanguageObjects.length > 0) {
      const objectNames = missingMainLanguageObjects
        .map(obj => {
          const availableLanguages = Object.keys(obj.data || {});
          const fallbackLang = availableLanguages[0];
          const data = fallbackLang ? obj.data[fallbackLang] : {};
          const name = data?.name || data?.title || obj.id;
          const type = obj.type.replace('_', ' ');
          return `- ${type}: ${name}`;
        })
        .join('\n');

      const confirmMessage = `The following objects only have content in a sub-language (not ${mainLanguage}):\n\n${objectNames}\n\nDo you want to send using sub-language content instead?`;

      if (!confirm(confirmMessage)) {
        return;
      }
    }

    if (pendingFunctionCallResults.length) {
      clearPendingResults();
    }

    clearInput(projectId);

    if (!input?.trim()) {
      await chatManager.processEmptyRequest();
      return;
    }

    const userMessage: ChatMessage = {
      id: generateTempId(),
      role: 'user',
      contentParts: [{ type: 'content', text: input.trim() }],
      timestamp: new Date(),
    };

    await chatManager.processUserMessage(userMessage);
  }, [projectId, chatManager, isLoading, clearInput, getActiveChatId, getObjectsMissingMainLanguage, mainLanguage, pendingFunctionCallResults, clearPendingResults]);

  const handleStop = useCallback(() => {
    chatManager?.abort();
  }, [chatManager]);

  const adjustTextareaHeight = useCallback(() => {
    if (editTextareaRef.current) {
      editTextareaRef.current.style.height = 'auto';
      editTextareaRef.current.style.height = `${editTextareaRef.current.scrollHeight}px`;
    }
  }, []);

  const handleEditMessage = useCallback((messageId: string, content: string, _language: string) => {
    if (!projectId) return;
    startEditing(projectId, messageId, mainLanguage, content);
    setTimeout(adjustTextareaHeight, 0);
  }, [projectId, startEditing, mainLanguage, adjustTextareaHeight]);

  const handleEditContentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (!projectId) return;
    updateEditContent(projectId, e.target.value);
    adjustTextareaHeight();
  }, [projectId, updateEditContent, adjustTextareaHeight]);

  const handleSaveEdit = useCallback(() => {
    if (!projectId) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    const editing = getEditing(projectId);
    if (!editing.messageId) return;

    const contentParts: ContentPart[] = [{ type: 'content', text: editing.content }];

    updateMessage(projectId, chatId, editing.messageId, contentParts, mainLanguage);
    clearMessageTranslations(projectId, chatId, editing.messageId, [mainLanguage]);
    cancelEditing(projectId);
  }, [projectId, getEditing, cancelEditing, getActiveChatId, updateMessage, clearMessageTranslations, mainLanguage]);

  const handleCancelEdit = useCallback(() => {
    if (!projectId) return;
    cancelEditing(projectId);
  }, [projectId, cancelEditing]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!projectId) return;
    const chatId = getActiveChatId();
    if (!chatId) return;

    if (confirm('Are you sure you want to delete this message?')) {
      deleteMessage(projectId, chatId, messageId);
    }
  }, [projectId, getActiveChatId, deleteMessage]);

  const chatHandlers: ChatHandlersReturn = {
    editTextareaRef,
    handleSelectChat,
    handleSubmit,
    handleStop,
    handleEditMessage,
    handleEditContentChange,
    handleSaveEdit,
    handleCancelEdit,
    handleDeleteMessage,
  };

  // ============================================================================
  // Return
  // ============================================================================

  return {
    chatManager,
    abortControllerRef,
    chatHandlers,
    functionCallState,
    functionCallHandlers,
    contextIds,
  };
}

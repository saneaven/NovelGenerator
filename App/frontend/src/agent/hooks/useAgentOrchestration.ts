/**
 * Unified Agent Orchestration Hook
 *
 * Consolidates agent management, function call handling, and context management
 * into a single hook used by both Workspace and NovelEditor pages.
 *
 * Mode only affects systemPrompt template selection - all other behavior is identical.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AgentManager, type AgentManagerCallbacks } from '../processors/AgentManager';
import { DefaultDisplayProcessor } from '../processors/DisplayProcessor';
import {
  AGENT_FUNCTIONS,
  useFunctionCallHandlers,
  type EditCard,
} from '../../functionCall';
import { useAgentStore } from '../../store/agentStore';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { generateTempId } from '../../utils/tempId';
import type { ChatMessage, FunctionCallMetadata } from '../../llm/requestTypes';
import type { ContentPart } from '../../api/types';
import type {
  AgentOrchestrationConfig,
  AgentOrchestrationReturn,
  FunctionCallState,
  FunctionCallHandlers,
  ContextIdState,
  AgentHandlersReturn,
} from './types';

/**
 * Unified agent orchestration hook
 *
 * Provides all agent-related functionality including:
 * - AgentManager instantiation and callbacks
 * - Function call handling (apply, reject, batch confirm)
 * - Context ID management (auto-select new objects)
 * - EditCard state management
 * - Agent interaction handlers (submit, edit, delete)
 */
export function useAgentOrchestration(config: AgentOrchestrationConfig): AgentOrchestrationReturn {
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
    getSelectedAgentId,
    selectAgent,
    deleteMessage,
    clearMessageTranslations,
  } = useAgentStore();

  const unifiedStore = useUnifiedObjectStore();
  const settings = useSettingsStore(state => state.settings);
  const mainLanguage = settings.mainLanguage;
  const agentFunctionConfig = settings.functionConfigs.agent;
  const providerCredentials = settings.providerCredentials;

  // Agent UI actions (selected individually to avoid re-renders)
  const isLoading = useAgentUIStore(state => state.isLoading);
  const clearInput = useAgentUIStore(state => state.clearInput);
  const startEditing = useAgentUIStore(state => state.startEditing);
  const updateEditContent = useAgentUIStore(state => state.updateEditContent);
  const getEditing = useAgentUIStore(state => state.getEditing);
  const cancelEditing = useAgentUIStore(state => state.cancelEditing);
  const closeSidebar = useSidebarStore(state => state.closeSidebar);
  const getObjectsMissingMainLanguage = useUnifiedObjectStore(state => state.getObjectsMissingMainLanguage);

  // ============================================================================
  // Context ID Management
  // ============================================================================

  // Selected context IDs for agent - initialized with all project objects
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>(() => {
    return Object.keys(unifiedStore.objects)
      .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId);
  });

  // Track previous object IDs to auto-select newly created objects
  const prevObjectIdsRef = useRef<Set<string>>(new Set(selectedContextIds));

  // Ref to always get current selectedContextIds (avoid stale closure in AgentManager)
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
  // Function Call Handling (using common hook)
  // ============================================================================

  // Session tracking for error propagation to toast
  const messageSessionMap = useRef<Record<string, string>>({});

  const getActiveAgentId = useCallback(
    () => (projectId ? getSelectedAgentId(projectId) : undefined),
    [projectId, getSelectedAgentId]
  );

  const registerSessionForMessage = useCallback(
    (messageId: string, sessionId: string) => {
      messageSessionMap.current[messageId] = sessionId;
    },
    []
  );

  // Use the common function call handlers hook
  const { state: fcState, actions: fcActions } = useFunctionCallHandlers({
    projectId: projectId ?? '',
    language: mainLanguage,
    storageMode: 'message',
    onUpdateStatus: (messageId, functionCallId, status, options) => {
      if (!projectId) return;
      const agentId = getActiveAgentId();
      if (!agentId) return;
      updateFunctionCallStatus(projectId, agentId, messageId, functionCallId, status, options);
    },
    getSessionId: (messageId) => messageSessionMap.current[messageId],
  });

  // Wrap handleFunctionCalls to also sync to backend
  const handleFunctionCalls = useCallback(
    async (messageId: string, functionCalls: FunctionCallMetadata[]) => {
      if (!projectId) return;
      const agentId = getActiveAgentId();
      if (!agentId) return;

      // Sync function calls to backend first
      updateMessageFunctionCalls(projectId, agentId, messageId, functionCalls);

      // Then process with common hook
      await fcActions.handleFunctionCalls(messageId, functionCalls);
    },
    [projectId, getActiveAgentId, updateMessageFunctionCalls, fcActions]
  );

  // Alias for backward compatibility
  const messageEditCards = fcState.editCards;
  const activeFunctionCalls = fcState.activeFunctionCalls;
  const { handleFunctionCallProgress, handleBatchConfirm, isConfirmed: isMessageConfirmed } = fcActions;
  const { createApplyHandler, createRejectHandler } = fcActions;
  const setMessageEditCards = fcActions.setEditCards;
  const setConfirmedMessages = fcActions.setConfirmedKeys;

  const functionCallState: FunctionCallState = {
    messageEditCards,
    activeFunctionCalls,
  };

  const functionCallHandlers: FunctionCallHandlers = {
    handleBatchConfirm,
    isMessageConfirmed,
    createApplyHandler,
    createRejectHandler,
    handleFunctionCalls,
    handleFunctionCallProgress,
    registerSessionForMessage,
    setMessageEditCards,
    setConfirmedMessages,
  };

  // ============================================================================
  // AgentManager Setup
  // ============================================================================

  const abortControllerRef = useRef<AbortController | null>(null);

  const agentManagerCallbacks = useMemo<AgentManagerCallbacks>(() => ({
    onUpdateMessage: (projId, agentId, messageId, contentParts, language, thinking_details) => {
      updateMessageContentLocal(projId, agentId, messageId, contentParts, language, thinking_details);
    },
    onSyncMessageToBackend: async (projId, agentId, messageId, contentParts, language, thinking_details) => {
      await updateMessage(projId, agentId, messageId, contentParts, language, thinking_details);
    },
    onFunctionCalls: (_projId, _agentId, messageId, functionCalls, sessionId) => {
      // Register sessionId for this message so function call errors can update the toast
      if (sessionId) {
        registerSessionForMessage(messageId, sessionId);
      }
      handleFunctionCalls(messageId, functionCalls);
    },
    onAddMessage: async (projId, agentId, message, language) => {
      return await addMessage(projId, agentId, message, language);
    },
    onGetAgentHistory: (projId, agentId, language) => getMessages(projId, agentId, language),
    onError: (error) => {
      // Legacy callback - errors are now shown inline via onErrorMessage
      console.error('Runtime processing error:', error);
    },
    onErrorMessage: (projId, agentId, messageId, errorMessage, language) => {
      // Append error content part to the message for inline display
      const messages = getMessages(projId, agentId, language);
      const message = messages.find(m => m.id === messageId);
      if (message) {
        const errorPart = { type: 'error' as const, text: errorMessage };
        const newParts = [...message.contentParts, errorPart];
        updateMessageContentLocal(projId, agentId, messageId, newParts, language);
      }
    },
    onFunctionCallProgress: (_projId, _agentId, messageId, progressEvents) => {
      handleFunctionCallProgress(messageId, progressEvents);
    },
  }), [updateMessageContentLocal, updateMessage, handleFunctionCalls, addMessage, getMessages, handleFunctionCallProgress, registerSessionForMessage]);

  const agentManager = useMemo(() => {
    const activeProjectId = projectId ?? '';
    if (!activeProjectId) return null;

    return new AgentManager(
      {
        projectId: activeProjectId,
        getIsLoading: () => useAgentUIStore.getState().isLoading(activeProjectId),
        setIsLoading: (loading: boolean) => useAgentUIStore.getState().setLoading(activeProjectId, loading),
        abortControllerRef,
        getActiveAgentId: () => {
          if (!activeProjectId) return undefined;
          return getSelectedAgentId(activeProjectId);
        },
        getConversationLanguage: () => mainLanguage,
        aiModel: agentFunctionConfig.model,
        temperature: agentFunctionConfig.temperature,
        provider: agentFunctionConfig.provider,
        providerConfig: providerCredentials[agentFunctionConfig.provider],
        functions: AGENT_FUNCTIONS,
        mode,
        enablePrefill: agentFunctionConfig.advanced.enablePrefill,
        thinkingMode: agentFunctionConfig.advanced.thinkingMode,
        thinkingConfig: agentFunctionConfig.advanced.thinkingConfig,
        retryConfig: settings.retryConfig,
        getSelectedContextIds: () => selectedContextIdsRef.current,
      },
      agentManagerCallbacks
    );
  }, [
    projectId,
    mainLanguage,
    agentFunctionConfig,
    providerCredentials,
    getSelectedAgentId,
    agentManagerCallbacks,
    settings.retryConfig,
    mode,
  ]);

  // ============================================================================
  // EditCard Restoration Effect
  // ============================================================================

  const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);

  // Get selected agent ID reactively to trigger effect when agent changes
  const selectedAgentId = useAgentStore(state =>
    projectId ? state.selectedAgentByProject[projectId] : undefined
  );

  // Get message count reactively to trigger effect when messages are loaded
  const messageCount = useAgentStore(state => {
    if (!projectId || !selectedAgentId) return 0;
    const agent = state.agentsByProject[projectId]?.find(a => a.id === selectedAgentId);
    return agent?.messages?.length ?? 0;
  });

  useEffect(() => {
    if (!projectId || !selectedAgentId) return;

    const messages = getMessages(projectId, selectedAgentId, mainLanguage);
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
                functionCall: {
                  ...card.functionCall,
                  acceptedAt: funcCall.acceptedAt,
                },
                onApply: createApplyHandler(message.id, funcCall),
                onReject: createRejectHandler(message.id, funcCall),
              };
            }
          }
          return card;
        });
        restored[message.id] = cards;

        // Check if all function calls in this message have been processed (not pending)
        const allProcessed = cards.every(card => card.functionCall.status !== 'pending');
        if (allProcessed && cards.length > 0) {
          restoredConfirmed[message.id] = true;
        }
      }
    });

    setMessageEditCards(restored);
    setConfirmedMessages(() => restoredConfirmed);
  }, [projectId, selectedAgentId, messageCount, getMessages, mainLanguage, mode, displayProcessor, createApplyHandler, createRejectHandler, setMessageEditCards, setConfirmedMessages]);

  // ============================================================================
  // Agent Handlers
  // ============================================================================

  const editTextareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSelectAgent = useCallback((agentId: string) => {
    if (!projectId) return;
    selectAgent(projectId, agentId);
    closeSidebar(projectId);
  }, [projectId, selectAgent, closeSidebar]);

  const handleSubmit = useCallback(async (e: React.FormEvent, input: string) => {
    e.preventDefault();
    if (!projectId || !agentManager) return;
    if (isLoading(projectId)) return;

    const agentId = getActiveAgentId();
    if (!agentId) return;

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

    clearInput(projectId);

    if (!input?.trim()) {
      await agentManager.processEmptyRequest();
      return;
    }

    const userMessage: ChatMessage = {
      id: generateTempId(),
      role: 'user',
      contentParts: [{ type: 'content', text: input.trim() }],
      timestamp: new Date(),
    };

    await agentManager.processUserMessage(userMessage);
  }, [projectId, agentManager, isLoading, clearInput, getActiveAgentId, getObjectsMissingMainLanguage, mainLanguage]);

  const handleStop = useCallback(() => {
    agentManager?.abort();
  }, [agentManager]);

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
    const agentId = getActiveAgentId();
    if (!agentId) return;

    const editing = getEditing(projectId);
    if (!editing.messageId) return;

    const contentParts: ContentPart[] = [{ type: 'content', text: editing.content }];

    updateMessage(projectId, agentId, editing.messageId, contentParts, mainLanguage);
    clearMessageTranslations(projectId, agentId, editing.messageId, [mainLanguage]);
    cancelEditing(projectId);
  }, [projectId, getEditing, cancelEditing, getActiveAgentId, updateMessage, clearMessageTranslations, mainLanguage]);

  const handleCancelEdit = useCallback(() => {
    if (!projectId) return;
    cancelEditing(projectId);
  }, [projectId, cancelEditing]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!projectId) return;
    const agentId = getActiveAgentId();
    if (!agentId) return;

    if (confirm('Are you sure you want to delete this message?')) {
      deleteMessage(projectId, agentId, messageId);
    }
  }, [projectId, getActiveAgentId, deleteMessage]);

  const agentHandlers: AgentHandlersReturn = {
    editTextareaRef,
    handleSelectAgent,
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
    agentManager,
    abortControllerRef,
    agentHandlers,
    functionCallState,
    functionCallHandlers,
    contextIds,
  };
}

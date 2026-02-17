/**
 * Unified Agent Orchestration Hook
 *
 * Starts agent requests via ThreadOrchestrator and provides UI helpers
 * (context selection, abort, edit/delete message).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../store/agentStore';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettings } from '../../store/settingsStore';
import { useErrorStore } from '../../store/errorStore';
import type { AgentOrchestrationConfig, AgentOrchestrationReturn, AgentHandlersReturn, ContextIdState } from './types';
import { getSendBlockingState, getSendBlockedReasonMessage } from '../../toolCall/viewModel/blockingSelectors';
import { getThreadMessageIds } from '../../runtime/selectors/conversationTimeline';
import { threadOrchestrator } from '../../runtime';
import { useThreadStore } from '../../runtime';
import { threadService } from '../../api/threadService';
import { isUuid } from '../../utils/idUtils';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

export function useAgentOrchestration(config: AgentOrchestrationConfig): AgentOrchestrationReturn {
  const { projectId, runMode, surface } = config;
  const { t } = useTranslation();

  const {
    getSelectedAgentId,
    getAgents,
    fetchAgents,
    getAgent,
    selectAgent,
  } = useAgentStore();
  const selectedAgentIdForRecovery = useAgentStore((state) =>
    projectId ? state.selectedAgentByProject[projectId] : undefined,
  );
  const selectedThreadIdForRecovery = useAgentStore((state) => {
    if (!projectId) return undefined;
    const selectedId = state.selectedAgentByProject[projectId];
    if (!selectedId) return undefined;
    return state.agentsByProject[projectId]?.find((agent) => agent.id === selectedId)?.thread_id ?? undefined;
  });

  const unifiedStore = useUnifiedObjectStore();
  const settings = useSettings();
  const mainLanguage = settings.mainLanguage;

  const clearInput = useAgentUIStore(state => state.clearInput);
  const startEditing = useAgentUIStore(state => state.startEditing);
  const updateEditContent = useAgentUIStore(state => state.updateEditContent);
  const getEditing = useAgentUIStore(state => state.getEditing);
  const cancelEditing = useAgentUIStore(state => state.cancelEditing);
  const markAgentViewed = useAgentUIStore(state => state.markAgentViewed);
  const closeSidebar = useSidebarStore(state => state.closeSidebar);
  const getObjectsMissingMainLanguage = useUnifiedObjectStore(state => state.getObjectsMissingMainLanguage);
  const showError = useErrorStore(state => state.showError);

  // ============================================================================
  // Context ID management (auto-select newly created objects)
  // ============================================================================

  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);

  const totalObjectCount = useMemo(() => {
    if (!projectId) return 0;
    return Object.keys(unifiedStore.objects)
      .filter(id => {
        const obj = unifiedStore.objects[id];
        return obj.metadata?.project_id === projectId && obj.type !== 'basic_info';
      })
      .length;
  }, [unifiedStore.objects, projectId]);

  const contextIds: ContextIdState = {
    selectedContextIds,
    setSelectedContextIds,
    totalObjectCount,
  };

  // ============================================================================
  // Helper: resolve threadId for the selected agent
  // ============================================================================

  const resolveThreadId = useCallback((): string | undefined => {
    if (!projectId) return undefined;
    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return undefined;
    const agent = getAgent(projectId, agentId);
    return agent?.thread_id ?? undefined;
  }, [projectId, getSelectedAgentId, getAgent]);

  // ============================================================================
  // Active thread tracking (for Stop button + loading state)
  // ============================================================================

  const preflightAbortControllerByAgentRef = useRef<Record<string, AbortController>>({});

  // Sync loading state from thread store status
  useEffect(() => {
    if (!projectId) return;

    function syncLoading() {
      const agentId = getSelectedAgentId(projectId!);
      if (!agentId) return;
      const agent = getAgent(projectId!, agentId);
      const threadId = agent?.thread_id;
      if (!threadId) {
        useAgentUIStore.getState().setLoading(projectId!, agentId, false);
        return;
      }
      const thread = useThreadStore.getState().threadsById[threadId];
      const isActive = thread?.status === 'running' || thread?.status === 'waiting_tools';
      useAgentUIStore.getState().setLoading(projectId!, agentId, isActive);
    }

    syncLoading();
    const unsubscribe = useThreadStore.subscribe(syncLoading);
    return unsubscribe;
  }, [projectId, getSelectedAgentId, getAgent]);

  useEffect(() => {
    const controllersRef = preflightAbortControllerByAgentRef;
    return () => {
      for (const controller of Object.values(controllersRef.current)) {
        controller.abort();
      }
    };
  }, []);

  // Recover thread state on mount — cancel any actively running generation.
  useEffect(() => {
    if (!projectId || !selectedThreadIdForRecovery) return;
    void (async () => {
      try {
        await threadOrchestrator.recover(projectId, selectedThreadIdForRecovery);
        const thread = useThreadStore.getState().getThread(selectedThreadIdForRecovery);
        if (thread?.status === 'running') {
          await threadOrchestrator.cancel(projectId, selectedThreadIdForRecovery);
        }
      } catch (error) {
        console.warn('Failed to recover thread state:', error);
      }
    })();
  }, [projectId, selectedAgentIdForRecovery, selectedThreadIdForRecovery]);

  // If selection is missing but agents exist, recover selection automatically.
  const agentRecoveryAttemptedByProjectRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!projectId) return;

    if (selectedAgentIdForRecovery) {
      delete agentRecoveryAttemptedByProjectRef.current[projectId];
      return;
    }

    const existingAgents = getAgents(projectId);
    if (existingAgents.length > 0) {
      const fallbackAgentId = existingAgents[0].id;
      selectAgent(projectId, fallbackAgentId);
      markAgentViewed(projectId, fallbackAgentId);
      useAgentUIStore.getState().setPreflightToast(projectId, null);
      return;
    }

    if (agentRecoveryAttemptedByProjectRef.current[projectId]) return;
    agentRecoveryAttemptedByProjectRef.current[projectId] = true;

    void fetchAgents(projectId)
      .then(() => {
        const refreshedAgents = getAgents(projectId);
        if (refreshedAgents.length > 0) {
          const fallbackAgentId = refreshedAgents[0].id;
          selectAgent(projectId, fallbackAgentId);
          markAgentViewed(projectId, fallbackAgentId);
          useAgentUIStore.getState().setPreflightToast(projectId, null);
          return;
        }
        useAgentUIStore.getState().setPreflightToast(projectId, {
          type: 'error',
          message: 'No available agent found. Create a new agent to continue.',
        });
      })
      .catch((error) => {
        console.error('Failed to recover agent selection:', error);
        useAgentUIStore.getState().setPreflightToast(projectId, {
          type: 'error',
          message: t('agent.memory.preflightFailed', { error: toErrorMessage(error) }),
        });
      });
  }, [
    projectId,
    selectedAgentIdForRecovery,
    getAgents,
    fetchAgents,
    selectAgent,
    markAgentViewed,
    t,
  ]);

  // ============================================================================
  // Agent handlers
  // ============================================================================

  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSelectAgent = useCallback((agentId: string) => {
    if (!projectId) return;
    selectAgent(projectId, agentId);
    markAgentViewed(projectId, agentId);
    closeSidebar(projectId);
  }, [projectId, selectAgent, markAgentViewed, closeSidebar]);

  const handleSubmit = useCallback(async (e: FormEvent, input: string) => {
    e.preventDefault();
    if (!projectId) return;

    const uiStore = useAgentUIStore.getState();
    const setPreflightError = (message: string) => {
      uiStore.setPreflightToast(projectId, { type: 'error', message });
    };

    const resolveAgentIdForSend = async (): Promise<string | null> => {
      let activeAgentId = getSelectedAgentId(projectId);
      if (activeAgentId) return activeAgentId;

      const existingAgents = getAgents(projectId);
      if (existingAgents.length > 0) {
        activeAgentId = existingAgents[0].id;
        selectAgent(projectId, activeAgentId);
        markAgentViewed(projectId, activeAgentId);
        return activeAgentId;
      }

      try {
        await fetchAgents(projectId);
      } catch (error) {
        console.warn('Failed to refresh agents before sending:', error);
      }

      const refreshedAgents = getAgents(projectId);
      if (refreshedAgents.length > 0) {
        activeAgentId = refreshedAgents[0].id;
        selectAgent(projectId, activeAgentId);
        markAgentViewed(projectId, activeAgentId);
        return activeAgentId;
      }
      return null;
    };

    try {
      const userInput = input ?? '';
      const trimmedInput = userInput.trim();

      const agentId = await resolveAgentIdForSend();
      const fallbackBlocking = getSendBlockingState({
        selectedAgentId: agentId ?? undefined,
        messageIds: [],
      });
      if (!agentId) {
        setPreflightError(
          getSendBlockedReasonMessage(fallbackBlocking)
            ?? 'No available agent found. Create a new agent to continue.',
        );
        return;
      }

      const threadId = getAgent(projectId, agentId)?.thread_id ?? undefined;


      if (!trimmedInput) {
        if (!threadId) {
          setPreflightError('Input cannot be empty.');
          return;
        }
        
        // empty input on existing thread → resume
        await threadOrchestrator.resume({
          projectId,
          threadId,
        });
        return;
      }

      const isThreadStreamActive = threadId
        ? Boolean(useThreadStore.getState().activeStreamByThread[threadId])
        : false;
      const messageIds = threadId ? getThreadMessageIds(threadId) : [];
      const sendBlockingState = getSendBlockingState({
        selectedAgentId: agentId,
        messageIds,
        toolCallsByMessageId: useThreadStore.getState().toolCallsByMessageId,
        isThreadStreamActive,
      });
      if (sendBlockingState.blocked) {
        const reason = getSendBlockedReasonMessage(sendBlockingState)
          ?? 'Resolve pending operations before sending.';
        setPreflightError(reason);
        return;
      }

      const missingMainLanguageObjects = getObjectsMissingMainLanguage(projectId, mainLanguage);
      if (missingMainLanguageObjects.length > 0) {
        const objectNames = missingMainLanguageObjects
          .map(obj => {
            const availableLanguages = Object.keys(obj.data || {});
            const fallbackLang = availableLanguages[0];
            const data = fallbackLang ? obj.data[fallbackLang] : {};
            const name = (data as any)?.name || (data as any)?.title || obj.id;
            const type = obj.type.replace('_', ' ');
            return `- ${type}: ${name}`;
          })
          .join('\n');

        const confirmMessage = `The following objects only have content in a sub-language (not ${mainLanguage}):\n\n${objectNames}\n\nDo you want to send using sub-language content instead?`;

        if (!confirm(confirmMessage)) {
          setPreflightError('Send cancelled.');
          return;
        }
      }

      clearInput(projectId);
      uiStore.setLoading(projectId, agentId, true);
      uiStore.setPreflightToast(projectId, null);

      const abortController = new AbortController();
      preflightAbortControllerByAgentRef.current[agentId] = abortController;

      try {
        await threadOrchestrator.dispatch({
          projectId,
          threadType: 'agent',
          threadId: threadId ?? undefined,
          inputText: trimmedInput,
          language: mainLanguage,
          runMode,
          surface,
          contextObjectIds: selectedContextIds,
          signal: abortController.signal,
        });
      } catch (error) {
        if (isAbortError(error) || abortController.signal.aborted) {
          uiStore.setInput(projectId, userInput);
          uiStore.setLoading(projectId, agentId, false);
          uiStore.setPreflightToast(projectId, null);
          delete preflightAbortControllerByAgentRef.current[agentId];
          return;
        }

        console.error('Failed to dispatch:', error);
        setPreflightError(t('agent.memory.preflightFailed', { error: toErrorMessage(error) }));
        uiStore.setInput(projectId, userInput);
        uiStore.setLoading(projectId, agentId, false);
        delete preflightAbortControllerByAgentRef.current[agentId];
        return;
      }

      delete preflightAbortControllerByAgentRef.current[agentId];
      uiStore.setPreflightToast(projectId, null);
    } catch (error) {
      console.error('Agent submit failed:', error);
      setPreflightError(t('agent.memory.preflightFailed', { error: toErrorMessage(error) }));
    }
  }, [
    projectId,
    getSelectedAgentId,
    getAgents,
    fetchAgents,
    getAgent,
    selectAgent,
    markAgentViewed,
    getObjectsMissingMainLanguage,
    mainLanguage,
    clearInput,
    runMode,
    surface,
    selectedContextIds,
    t,
  ]);

  const handleStop = useCallback(() => {
    if (!projectId) return;
    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;

    const preflight = preflightAbortControllerByAgentRef.current[agentId];
    if (preflight) {
      preflight.abort();
      delete preflightAbortControllerByAgentRef.current[agentId];
      return;
    }

    const threadId = resolveThreadId();
    if (threadId) {
      void threadOrchestrator.cancel(projectId, threadId).catch((error) => {
        console.error('Failed to cancel thread:', error);
      });
    }
  }, [projectId, getSelectedAgentId, resolveThreadId]);

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

  const handleEditContentChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    if (!projectId) return;
    updateEditContent(projectId, e.target.value);
    adjustTextareaHeight();
  }, [projectId, updateEditContent, adjustTextareaHeight]);

  const handleSaveEdit = useCallback(() => {
    if (!projectId) return;
    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;

    const editing = getEditing(projectId);
    if (!editing.messageId) return;
    if (!isUuid(editing.messageId)) {
      showError('Edit Failed', 'Message is not synced yet. Please try again once it is saved.');
      return;
    }

    const threadId = resolveThreadId();
    if (!threadId) {
      showError('Edit Failed', 'Could not find the thread.');
      return;
    }

    const newContentParts = [{ type: 'content', text: editing.content }];

    // Update local store
    const store = useThreadStore.getState();
    store.updateMessageData(threadId, editing.messageId, mainLanguage, {
      contentParts: newContentParts,
    });
    store.clearMessageTranslations(threadId, editing.messageId, [mainLanguage]);

    // Persist to backend
    void threadService.patchMessage(projectId, threadId, editing.messageId, {
      language: mainLanguage,
      content_parts: newContentParts as Array<Record<string, any>>,
    }).catch((error) => {
      console.error('Failed to persist message edit:', error);
    });

    cancelEditing(projectId);
  }, [projectId, getSelectedAgentId, getEditing, mainLanguage, cancelEditing, showError, resolveThreadId]);

  const handleCancelEdit = useCallback(() => {
    if (!projectId) return;
    cancelEditing(projectId);
  }, [projectId, cancelEditing]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!projectId) return;
    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;

    if (!confirm('Are you sure you want to delete this message?')) return;

    const threadId = resolveThreadId();
    if (!threadId) {
      showError('Delete Failed', 'Could not find the thread.');
      return;
    }
    if (!isUuid(messageId)) {
      useThreadStore.getState().removeMessage(threadId, messageId);
      return;
    }

    void (async () => {
      try {
        await threadService.deleteMessage(projectId, threadId, messageId);
      } catch (error) {
        console.error('Failed to delete message from backend:', error);
        showError('Delete Failed', error instanceof Error ? error.message : 'Failed to delete message.');
        return;
      }

      useThreadStore.getState().removeMessage(threadId, messageId);
    })();
  }, [projectId, getSelectedAgentId, showError, resolveThreadId]);

  const triggerAutoContinue = useCallback(async () => {
    if (!projectId) return;

    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;
    if (useAgentUIStore.getState().isLoading(projectId, agentId)) return;

    const threadId = resolveThreadId();
    if (!threadId) return;

    useAgentUIStore.getState().setLoading(projectId, agentId, true);
    useAgentUIStore.getState().setPreflightToast(projectId, null);

    const abortController = new AbortController();
    preflightAbortControllerByAgentRef.current[agentId] = abortController;

    try {
      await threadOrchestrator.resume({
        projectId,
        threadId,
        signal: abortController.signal,
      });
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted) {
        useAgentUIStore.getState().setLoading(projectId, agentId, false);
        useAgentUIStore.getState().setPreflightToast(projectId, null);
        delete preflightAbortControllerByAgentRef.current[agentId];
        return;
      }

      console.error('ThreadOrchestrator.resume (auto-continue) failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      useAgentUIStore.getState().setPreflightToast(projectId, {
        type: 'error',
        message: t('agent.memory.preflightFailed', { error: errorMessage }),
      });
      useAgentUIStore.getState().setLoading(projectId, agentId, false);
      delete preflightAbortControllerByAgentRef.current[agentId];
      return;
    }

    delete preflightAbortControllerByAgentRef.current[agentId];
    useAgentUIStore.getState().setPreflightToast(projectId, null);
  }, [projectId, getSelectedAgentId, t, resolveThreadId]);

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
    triggerAutoContinue,
  };

  return {
    agentHandlers,
    contextIds,
  };
}

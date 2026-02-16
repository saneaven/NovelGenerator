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
import { getSendBlockingState } from '../../toolCall/viewModel/blockingSelectors';
import { getThreadMessageIds } from '../../runtime/selectors/conversationTimeline';
import { threadOrchestrator } from '../../runtime';
import { useThreadStore } from '../../runtime';
import { threadService } from '../../api/threadService';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useAgentOrchestration(config: AgentOrchestrationConfig): AgentOrchestrationReturn {
  const { projectId, runMode, surface } = config;
  const { t } = useTranslation();

  const {
    getSelectedAgentId,
    getAgent,
    selectAgent,
  } = useAgentStore();

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
    return () => {
      for (const controller of Object.values(preflightAbortControllerByAgentRef.current)) {
        controller.abort();
      }
    };
  }, []);

  // Recover thread state on mount
  useEffect(() => {
    if (!projectId) return;
    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;
    const agent = getAgent(projectId, agentId);
    const threadId = agent?.thread_id;
    if (!threadId) return;

    void threadOrchestrator.recover(projectId, threadId).catch((error) => {
      console.warn('Failed to recover thread state:', error);
    });
  }, [projectId, getSelectedAgentId, getAgent]);

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

    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;
    if (useAgentUIStore.getState().isLoading(projectId, agentId)) return;

    const threadId = resolveThreadId();
    const messageIds = threadId ? getThreadMessageIds(threadId) : [];
    const sendBlockingState = getSendBlockingState({
      selectedAgentId: agentId,
      messageIds,
      toolCallsByMessageId: useThreadStore.getState().toolCallsByMessageId,
    });
    if (sendBlockingState.blocked) {
      useAgentUIStore.getState().setPreflightToast(projectId, {
        type: 'error',
        message: 'Resolve pending or running operations before sending a new message.',
      });
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
        return;
      }
    }

    const userInput = input ?? '';

    clearInput(projectId);
    useAgentUIStore.getState().setLoading(projectId, agentId, true);
    useAgentUIStore.getState().setPreflightToast(projectId, null);

    const abortController = new AbortController();
    preflightAbortControllerByAgentRef.current[agentId] = abortController;

    try {
      await threadOrchestrator.dispatch({
        projectId,
        threadType: 'agent',
        threadId: threadId ?? undefined,
        inputText: userInput?.trim() ?? '',
        language: mainLanguage,
        runMode,
        surface,
        contextObjectIds: selectedContextIds,
        signal: abortController.signal,
      });
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted) {
        useAgentUIStore.getState().setInput(projectId, userInput);
        useAgentUIStore.getState().setLoading(projectId, agentId, false);
        useAgentUIStore.getState().setPreflightToast(projectId, null);
        delete preflightAbortControllerByAgentRef.current[agentId];
        return;
      }

      console.error('Failed to dispatch:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      useAgentUIStore.getState().setPreflightToast(projectId, {
        type: 'error',
        message: t('agent.memory.preflightFailed', { error: errorMessage }),
      });
      useAgentUIStore.getState().setInput(projectId, userInput);
      useAgentUIStore.getState().setLoading(projectId, agentId, false);
      delete preflightAbortControllerByAgentRef.current[agentId];
      return;
    }

    delete preflightAbortControllerByAgentRef.current[agentId];
    useAgentUIStore.getState().setPreflightToast(projectId, null);
  }, [projectId, getSelectedAgentId, getObjectsMissingMainLanguage, mainLanguage, clearInput, runMode, surface, selectedContextIds, t, resolveThreadId]);

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

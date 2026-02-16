/**
 * Unified Agent Orchestration Hook
 *
 * Starts agent requests via RuntimeOrchestrator and provides UI helpers
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
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useErrorStore } from '../../store/errorStore';
import type { AgentOrchestrationConfig, AgentOrchestrationReturn, AgentHandlersReturn, ContextIdState } from './types';
import { getSendBlockingState } from '../../toolCall/viewModel/blockingSelectors';
import { getAgentRunMessageIds } from '../../runtime/selectors/conversationTimeline';
import { runtimeOrchestrator } from '../../runtime';
import { useRuntimeStore } from '../../runtime';
import { runService } from '../../api/runService';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function useAgentOrchestration(config: AgentOrchestrationConfig): AgentOrchestrationReturn {
  const { projectId, runMode, surface } = config;
  const { t } = useTranslation();

  const {
    getSelectedAgentId,
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
  // Active session tracking (for Stop button + loading state)
  // ============================================================================

  const preflightAbortControllerByAgentRef = useRef<Record<string, AbortController>>({});

  useEffect(() => {
    if (!projectId) return;
    const activeProjectId = projectId;
    function syncLoadingFromSessions() {
      const agentId = getSelectedAgentId(activeProjectId);
      if (!agentId) return;

      const allSessions = Object.values(useLLMSessionStore.getState().sessions)
        .filter((session): session is NonNullable<typeof session> => Boolean(session));

      const hasRunning = allSessions.some((session) => {
        if (session.kind !== 'agent') return false;
        if ((session.input as any)?.projectId !== activeProjectId) return false;
        if ((session.input as any)?.agentId !== agentId) return false;
        return session.status === 'running' || session.status === 'applying';
      });

      useAgentUIStore.getState().setLoading(activeProjectId, agentId, hasRunning);
    }

    syncLoadingFromSessions();
    const unsubscribe = useLLMSessionStore.subscribe(syncLoadingFromSessions);
    return unsubscribe;
  }, [projectId, getSelectedAgentId]);

  useEffect(() => {
    return () => {
      for (const controller of Object.values(preflightAbortControllerByAgentRef.current)) {
        controller.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (!projectId) return;
    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;

    void runtimeOrchestrator.recoverRuns(projectId, agentId).catch((error) => {
      console.warn('Failed to recover interrupted runs:', error);
    });
  }, [projectId, getSelectedAgentId]);

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

    const runMessageIds = getAgentRunMessageIds(projectId, agentId);
    const sessions = Object.values(useLLMSessionStore.getState().sessions)
      .filter((session): session is NonNullable<typeof session> => Boolean(session))
      .filter((session) => {
        if (session.kind !== 'agent') return false;
        return (session.input as any)?.projectId === projectId;
      });
    const sendBlockingState = getSendBlockingState({
      selectedAgentId: agentId,
      runMessageIds,
      sessions,
      runToolCallsByMessageId: useRuntimeStore.getState().runToolCallsByMessageId,
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
      await runtimeOrchestrator.startRootRun({
        projectId,
        agentId,
        runMode,
        surface,
        userInput: userInput?.trim() ?? '',
        language: mainLanguage,
        contextObjectIds: selectedContextIds,
        signal: abortController.signal,
        onMemoryStageChange: (stage) => {
          const message =
            stage === 'summarizing'
              ? t('agent.memory.preflight.summarizing')
              : stage === 'archiving'
                ? t('agent.memory.preflight.archiving')
                : stage === 'searching'
                  ? t('agent.memory.preflight.searching')
                  : null;
          if (!message) return;
          useAgentUIStore.getState().setPreflightToast(projectId, { type: 'info', message });
        },
      });
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted) {
        useAgentUIStore.getState().setInput(projectId, userInput);
        useAgentUIStore.getState().setLoading(projectId, agentId, false);
        useAgentUIStore.getState().setPreflightToast(projectId, null);
        delete preflightAbortControllerByAgentRef.current[agentId];
        return;
      }

      console.error('Failed to start root run:', error);
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
  }, [projectId, getSelectedAgentId, getObjectsMissingMainLanguage, mainLanguage, clearInput, runMode, surface, selectedContextIds, t]);

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

    const runId = runtimeOrchestrator.findLatestOpenRootRunId(projectId, agentId);
    if (runId) {
      void runtimeOrchestrator.cancelRun(runId).catch((error) => {
        console.error('Failed to cancel root run:', error);
      });
      return;
    }

    const fallbackSession = Object.values(useLLMSessionStore.getState().sessions)
      .filter((session): session is NonNullable<typeof session> => Boolean(session))
      .find((session) => {
        if (session.kind !== 'agent') return false;
        if ((session.input as any)?.projectId !== projectId) return false;
        if ((session.input as any)?.agentId !== agentId) return false;
        return session.status === 'running' || session.status === 'applying';
      });
    if (fallbackSession) {
      useLLMSessionStore.getState().cancelSession(fallbackSession.id);
    }
  }, [projectId, getSelectedAgentId]);

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

    // Find the RunMessage's runId
    const runtime = useRuntimeStore.getState();
    let runId: string | undefined;
    for (const [rId, messages] of Object.entries(runtime.runMessagesByRunId)) {
      if (messages?.some(m => m.id === editing.messageId)) {
        runId = rId;
        break;
      }
    }

    if (!runId) {
      showError('Edit Failed', 'Could not find the message run.');
      return;
    }

    const newContentParts = [{ type: 'content', text: editing.content }];

    // Update local store
    runtime.updateRunMessageData(runId, editing.messageId, mainLanguage, {
      contentParts: newContentParts,
    });
    runtime.clearRunMessageTranslations(runId, editing.messageId, [mainLanguage]);

    // Persist to backend
    void runService.patchRunMessage(projectId, agentId, runId, editing.messageId, {
      language: mainLanguage,
      content_parts: newContentParts as Array<Record<string, any>>,
    }).catch((error) => {
      console.error('Failed to persist message edit:', error);
    });

    cancelEditing(projectId);
  }, [projectId, getSelectedAgentId, getEditing, mainLanguage, cancelEditing, showError]);

  const handleCancelEdit = useCallback(() => {
    if (!projectId) return;
    cancelEditing(projectId);
  }, [projectId, cancelEditing]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!projectId) return;
    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;

    if (!confirm('Are you sure you want to delete this message?')) return;

    void (async () => {
      // Find the RunMessage's runId
      const runtime = useRuntimeStore.getState();
      let runId: string | undefined;
      for (const [rId, messages] of Object.entries(runtime.runMessagesByRunId)) {
        if (messages?.some(m => m.id === messageId)) {
          runId = rId;
          break;
        }
      }

      if (!runId) {
        showError('Delete Failed', 'Could not find the message run.');
        return;
      }

      // Delete the single message from backend
      try {
        await runService.deleteRunMessage(projectId, agentId, runId, messageId);
      } catch (error) {
        console.error('Failed to delete message from backend:', error);
        showError('Delete Failed', error instanceof Error ? error.message : 'Failed to delete message.');
        return;
      }

      // Clean up local state (removes message; auto-cleans empty run)
      runtime.removeRunMessage(runId, messageId);
    })();
  }, [projectId, getSelectedAgentId, showError]);

  const triggerAutoContinue = useCallback(async () => {
    if (!projectId) return;

    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;
    if (useAgentUIStore.getState().isLoading(projectId, agentId)) return;

    useAgentUIStore.getState().setLoading(projectId, agentId, true);
    useAgentUIStore.getState().setPreflightToast(projectId, null);

    const rootRunId = runtimeOrchestrator.findLatestOpenRootRunId(projectId, agentId);
    if (!rootRunId) {
      useAgentUIStore.getState().setLoading(projectId, agentId, false);
      return;
    }

    const abortController = new AbortController();
    preflightAbortControllerByAgentRef.current[agentId] = abortController;

    try {
      await runtimeOrchestrator.resumeRunLoop({
        runId: rootRunId,
        refreshMemory: true,
        signal: abortController.signal,
        onMemoryStageChange: (stage) => {
          const message =
            stage === 'summarizing'
              ? t('agent.memory.preflight.summarizing')
              : stage === 'archiving'
                ? t('agent.memory.preflight.archiving')
                : stage === 'searching'
                  ? t('agent.memory.preflight.searching')
                  : null;
          if (!message) return;
          useAgentUIStore.getState().setPreflightToast(projectId, { type: 'info', message });
        },
      });
    } catch (error) {
      if (isAbortError(error) || abortController.signal.aborted) {
        useAgentUIStore.getState().setLoading(projectId, agentId, false);
        useAgentUIStore.getState().setPreflightToast(projectId, null);
        delete preflightAbortControllerByAgentRef.current[agentId];
        return;
      }

      console.error('RuntimeOrchestrator.resumeRunLoop (auto-continue) failed:', error);
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
  }, [projectId, getSelectedAgentId, t]);

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

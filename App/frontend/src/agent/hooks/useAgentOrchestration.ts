/**
 * Unified Agent Orchestration Hook
 *
 * Starts agent requests via AgentExecutor and provides UI helpers
 * (context selection, abort, edit/delete message).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../../store/agentStore';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettings, useSettingsStore } from '../../store/settingsStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useSubAgentRuntimeStore } from '../../store/subAgentRuntimeStore';
import { useErrorStore } from '../../store/errorStore';
import { AgentExecutor } from '../AgentExecutor';
import { SubAgentManager } from '../../subAgent/runtime/SubAgentManager';
import { AgentMemoryManager } from '../memory/AgentMemoryManager';
import type { AgentOrchestrationConfig, AgentOrchestrationReturn, AgentHandlersReturn, ContextIdState } from './types';
import { getSendBlockingState } from '../../toolCall/viewModel/blockingSelectors';

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isAgentSessionActive(status: string | undefined): boolean {
  return status === 'running' || status === 'applying';
}

export function useAgentOrchestration(config: AgentOrchestrationConfig): AgentOrchestrationReturn {
  const { projectId, runMode, surface } = config;
  const { t } = useTranslation();

  const {
    updateMessage,
    deleteMessage,
    clearMessageTranslations,
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

  const [activeSessionIdByAgent, setActiveSessionIdByAgent] = useState<Record<string, string>>({});
  const activeSessionIdByAgentRef = useRef<Record<string, string>>({});
  const preflightAbortControllerByAgentRef = useRef<Record<string, AbortController>>({});

  // Keep ref in sync for handleStop to avoid stale closure
  useEffect(() => {
    activeSessionIdByAgentRef.current = activeSessionIdByAgent;
  }, [activeSessionIdByAgent]);

  useEffect(() => {
    if (!projectId) return;
    const currentProjectId = projectId;

    function processFinishedSessions() {
      const activeMap = activeSessionIdByAgentRef.current;
      if (Object.keys(activeMap).length === 0) return;

      const allSessions = useLLMSessionStore.getState().sessions;
      const finishedAgentIds: string[] = [];

      for (const [agentId, sessionId] of Object.entries(activeMap)) {
        const status = allSessions[sessionId]?.status;
        if (isAgentSessionActive(status)) continue;
        useAgentUIStore.getState().setLoading(currentProjectId, agentId, false);
        finishedAgentIds.push(agentId);
      }

      if (finishedAgentIds.length === 0) return;

      setActiveSessionIdByAgent((prev) => {
        const next = { ...prev };
        for (const agentId of finishedAgentIds) {
          delete next[agentId];
        }
        return next;
      });
    }

    // Process immediately in case sessions already finished
    processFinishedSessions();

    // Subscribe to LLM session store to detect when agent sessions complete
    const unsubscribe = useLLMSessionStore.subscribe(processFinishedSessions);
    return unsubscribe;
  }, [projectId]);

  useEffect(() => {
    return () => {
      for (const controller of Object.values(preflightAbortControllerByAgentRef.current)) {
        controller.abort();
      }
    };
  }, []);

  // ============================================================================
  // Agent handlers
  // ============================================================================

  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Stable ref-based callback for auto-continue chaining.
  // Uses a ref to avoid circular dependency: triggerAutoContinue uses handleAutoContinueReady,
  // and handleAutoContinueReady delegates to triggerAutoContinue.
  const autoContinueReadyRef = useRef<(() => void) | undefined>(undefined);

  const handleAutoContinueReady = useCallback(() => {
    autoContinueReadyRef.current?.();
  }, []);

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

    const selectedAgent = useAgentStore.getState().getSelectedAgent(projectId);
    const messages = selectedAgent?.messages ?? [];
    const sessions = Object.values(useLLMSessionStore.getState().sessions)
      .filter((session): session is NonNullable<typeof session> => Boolean(session))
      .filter((session) => {
        if (session.kind !== 'agent') return false;
        return (session.input as any)?.projectId === projectId;
      });
    const sendBlockingState = getSendBlockingState({
      selectedAgentId: agentId,
      messages,
      sessions,
      runsByKey: useSubAgentRuntimeStore.getState().runsByKey,
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

    const agentConfig = useSettingsStore.getState().getTaskConfig('agent');
    const outputMode = useSettingsStore.getState().getSettings().nativeOutputMode ? 'native_tool_call' : 'tool_call';

    let historyOverride: any[] | undefined;
    let promptContextOverride: Record<string, any> | undefined;
    try {
      const abortController = new AbortController();
      preflightAbortControllerByAgentRef.current[agentId] = abortController;

      const prepared = await AgentMemoryManager.prepare({
        projectId,
        agentId,
        runMode,
        surface,
        userInput: userInput?.trim() ?? '',
        outputLanguage: mainLanguage,
        outputMode,
        enable_prefill: agentConfig.advanced.enable_prefill,
        thinking_mode: agentConfig.advanced.thinking_mode,
        contextObjectIds: selectedContextIds,
      }, {
        signal: abortController.signal,
        onStageChange: (stage) => {
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
      historyOverride = prepared.historyForLLM;
      promptContextOverride = prepared.memory as any;
    } catch (error) {
      // Cancel = cancel send.
      if (isAbortError(error) || preflightAbortControllerByAgentRef.current[agentId]?.signal.aborted) {
        useAgentUIStore.getState().setInput(projectId, userInput);
        useAgentUIStore.getState().setLoading(projectId, agentId, false);
        useAgentUIStore.getState().setPreflightToast(projectId, null);
        delete preflightAbortControllerByAgentRef.current[agentId];
        return;
      }

      console.warn('AgentMemoryManager.prepare failed; cancelling send', error);
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

    // Use AgentExecutor directly (no JourneyRuntime)
    // Pass callback to get sessionId immediately for stop button to work
    void AgentExecutor.start(
      {
        projectId,
        agentId,
        runMode,
        surface,
        userInput: userInput?.trim() ?? '',
        outputLanguage: mainLanguage,
        contextObjectIds: selectedContextIds,
        historyOverride,
        promptContextOverride,
      },
      (sessionId) => setActiveSessionIdByAgent((prev) => ({ ...prev, [agentId]: sessionId })),
      handleAutoContinueReady,
    ).catch((error) => {
      console.error('AgentExecutor.start failed:', error);
      useAgentUIStore.getState().setLoading(projectId, agentId, false);
    });
  }, [projectId, getSelectedAgentId, getObjectsMissingMainLanguage, mainLanguage, clearInput, runMode, surface, selectedContextIds, handleAutoContinueReady, t]);

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
    const sessionId = activeSessionIdByAgentRef.current[agentId];
    if (!sessionId) return;
    useLLMSessionStore.getState().cancelSession(sessionId);
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

    updateMessage(projectId, agentId, editing.messageId, [{ type: 'content', text: editing.content }] as any, mainLanguage);
    clearMessageTranslations(projectId, agentId, editing.messageId, [mainLanguage]);
    cancelEditing(projectId);
  }, [projectId, getSelectedAgentId, getEditing, updateMessage, clearMessageTranslations, mainLanguage, cancelEditing]);

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
      try {
        await deleteMessage(projectId, agentId, messageId);
      } catch (error) {
        console.error('Failed to delete message:', error);
        showError('Delete Failed', error instanceof Error ? error.message : 'Failed to delete message.');
        return;
      }

      try {
        await SubAgentManager.discardByParentAgentMessage({
          agentId,
          parentMessageId: messageId,
          reason: 'Parent message deleted',
        });
      } catch (error) {
        console.error('Failed to discard local Sub Agent runtime state after message delete:', error);
      }
    })();
  }, [projectId, getSelectedAgentId, deleteMessage, showError]);

  const triggerAutoContinue = useCallback(async () => {
    if (!projectId) return;

    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;
    if (useAgentUIStore.getState().isLoading(projectId, agentId)) return;

    useAgentUIStore.getState().setLoading(projectId, agentId, true);
    useAgentUIStore.getState().setPreflightToast(projectId, null);

    const agentConfig = useSettingsStore.getState().getTaskConfig('agent');
    const outputMode = useSettingsStore.getState().getSettings().nativeOutputMode ? 'native_tool_call' : 'tool_call';

    let historyOverride: any[] | undefined;
    let promptContextOverride: Record<string, any> | undefined;
    try {
      const abortController = new AbortController();
      preflightAbortControllerByAgentRef.current[agentId] = abortController;

      const prepared = await AgentMemoryManager.prepare({
        projectId,
        agentId,
        runMode,
        surface,
        userInput: '',
        outputLanguage: mainLanguage,
        outputMode,
        enable_prefill: agentConfig.advanced.enable_prefill,
        thinking_mode: agentConfig.advanced.thinking_mode,
        contextObjectIds: selectedContextIds,
      }, {
        signal: abortController.signal,
        onStageChange: (stage) => {
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
      historyOverride = prepared.historyForLLM;
      promptContextOverride = prepared.memory as any;
    } catch (error) {
      if (isAbortError(error) || preflightAbortControllerByAgentRef.current[agentId]?.signal.aborted) {
        useAgentUIStore.getState().setLoading(projectId, agentId, false);
        useAgentUIStore.getState().setPreflightToast(projectId, null);
        delete preflightAbortControllerByAgentRef.current[agentId];
        return;
      }

      console.warn('AgentMemoryManager.prepare failed; cancelling auto-continue', error);
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

    // Empty userInput - tool results are already in the message history
    void AgentExecutor.start(
      {
        projectId,
        agentId,
        runMode,
        surface,
        userInput: '',
        outputLanguage: mainLanguage,
        contextObjectIds: selectedContextIds,
        historyOverride,
        promptContextOverride,
      },
      (sessionId) => setActiveSessionIdByAgent((prev) => ({ ...prev, [agentId]: sessionId })),
      handleAutoContinueReady,
    ).catch((error) => {
      console.error('AgentExecutor.start (auto-continue) failed:', error);
      useAgentUIStore.getState().setLoading(projectId, agentId, false);
    });
  }, [projectId, getSelectedAgentId, runMode, surface, mainLanguage, selectedContextIds, handleAutoContinueReady, t]);

  // Keep autoContinueReadyRef in sync with latest triggerAutoContinue
  useEffect(() => {
    autoContinueReadyRef.current = () => void triggerAutoContinue();
  }, [triggerAutoContinue]);

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

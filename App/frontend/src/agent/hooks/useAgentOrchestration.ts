/**
 * Unified Agent Orchestration Hook
 *
 * Starts agent requests via AgentExecutor and provides UI helpers
 * (context selection, abort, edit/delete message).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useAgentUIStore } from '../../store/agentUIStore';
import { useSidebarStore } from '../../store/sidebarStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { AgentExecutor } from '../AgentExecutor';
import type { AgentOrchestrationConfig, AgentOrchestrationReturn, AgentHandlersReturn, ContextIdState } from './types';

export function useAgentOrchestration(config: AgentOrchestrationConfig): AgentOrchestrationReturn {
  const { projectId, mode } = config;

  const {
    updateMessage,
    deleteMessage,
    clearMessageTranslations,
    getSelectedAgentId,
    selectAgent,
  } = useAgentStore();

  const unifiedStore = useUnifiedObjectStore();
  const settings = useSettingsStore(state => state.settings);
  const mainLanguage = settings.mainLanguage;

  const clearInput = useAgentUIStore(state => state.clearInput);
  const startEditing = useAgentUIStore(state => state.startEditing);
  const updateEditContent = useAgentUIStore(state => state.updateEditContent);
  const getEditing = useAgentUIStore(state => state.getEditing);
  const cancelEditing = useAgentUIStore(state => state.cancelEditing);
  const closeSidebar = useSidebarStore(state => state.closeSidebar);
  const getObjectsMissingMainLanguage = useUnifiedObjectStore(state => state.getObjectsMissingMainLanguage);

  // ============================================================================
  // Context ID management (auto-select newly created objects)
  // ============================================================================

  const [selectedContextIds, setSelectedContextIds] = useState<string[]>(() => {
    if (!projectId) return [];
    return Object.keys(unifiedStore.objects)
      .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId);
  });

  const prevObjectIdsRef = useRef<Set<string>>(new Set(selectedContextIds));

  useEffect(() => {
    if (!projectId) return;

    const currentIds = new Set(
      Object.keys(unifiedStore.objects)
        .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId)
    );

    const newIds = [...currentIds].filter(id => !prevObjectIdsRef.current.has(id));
    if (newIds.length > 0) {
      setSelectedContextIds(prev => [...new Set([...prev, ...newIds])]);
    }

    prevObjectIdsRef.current = currentIds;
  }, [unifiedStore.objects, projectId]);

  const totalObjectCount = useMemo(() => {
    if (!projectId) return 0;
    return Object.keys(unifiedStore.objects)
      .filter(id => unifiedStore.objects[id].metadata?.project_id === projectId)
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

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const activeSessionStatus = useLLMSessionStore(
    (state) => (activeSessionId ? state.sessions[activeSessionId]?.status : undefined)
  );

  useEffect(() => {
    if (!projectId) return;
    if (!activeSessionId) return;
    if (!activeSessionStatus) return;

    if (activeSessionStatus !== 'running' && activeSessionStatus !== 'applying') {
      useAgentUIStore.getState().setLoading(projectId, false);
      setActiveSessionId(null);
    }
  }, [activeSessionStatus, activeSessionId, projectId]);

  // ============================================================================
  // Agent handlers
  // ============================================================================

  const editTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const handleSelectAgent = useCallback((agentId: string) => {
    if (!projectId) return;
    selectAgent(projectId, agentId);
    closeSidebar(projectId);
  }, [projectId, selectAgent, closeSidebar]);

  const handleSubmit = useCallback(async (e: FormEvent, input: string) => {
    e.preventDefault();
    if (!projectId) return;

    if (useAgentUIStore.getState().isLoading(projectId)) return;

    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;

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

    clearInput(projectId);
    useAgentUIStore.getState().setLoading(projectId, true);

    // Use AgentExecutor directly (no JourneyRuntime)
    // Pass callback to get sessionId immediately for stop button to work
    void AgentExecutor.start(
      {
        projectId,
        agentId,
        mode,
        userInput: input?.trim() ?? '',
        outputLanguage: mainLanguage,
        contextObjectIds: selectedContextIds,
      },
      (sessionId) => setActiveSessionId(sessionId)
    );
  }, [projectId, getSelectedAgentId, getObjectsMissingMainLanguage, mainLanguage, clearInput, mode, selectedContextIds]);

  const handleStop = useCallback(() => {
    if (!activeSessionId) return;
    useLLMSessionStore.getState().cancelSession(activeSessionId);
  }, [activeSessionId]);

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

    if (confirm('Are you sure you want to delete this message?')) {
      deleteMessage(projectId, agentId, messageId);
    }
  }, [projectId, getSelectedAgentId, deleteMessage]);

  const triggerAutoContinue = useCallback(async () => {
    if (!projectId) return;
    if (useAgentUIStore.getState().isLoading(projectId)) return;

    const agentId = getSelectedAgentId(projectId);
    if (!agentId) return;

    useAgentUIStore.getState().setLoading(projectId, true);

    // Empty userInput - tool results are already in the message history
    void AgentExecutor.start(
      {
        projectId,
        agentId,
        mode,
        userInput: '',
        outputLanguage: mainLanguage,
        contextObjectIds: selectedContextIds,
      },
      (sessionId) => setActiveSessionId(sessionId)
    );
  }, [projectId, getSelectedAgentId, mode, mainLanguage, selectedContextIds]);

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

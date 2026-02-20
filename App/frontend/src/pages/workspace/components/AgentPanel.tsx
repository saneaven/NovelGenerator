import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAgentStore } from '../../../store/agentStore';
import { useAgentUIStore } from '../../../store/agentUIStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useDisplayLanguageStore } from '../../../store/displayLanguageStore';
import { useSettings } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { useThreadStore } from '../../../store/threadStore';
import { threadService } from '../../../api/threadService';
import { runMessageTranslation } from '../../../agent/messageTranslation';
import { isUuid } from '../../../utils/idUtils';
import {
  cancelThread,
  decideToolCall,
  decideToolCallsBatch,
  sendThreadMessage,
} from '../../../runtime/threadCommands';
import ObjectPicker from '../../../components/ObjectPicker/ObjectPicker';
import AgentSidebar from '../../../components/Agent/AgentSidebar';
import { DefaultDisplayProcessor } from '../../../agent/processors/DisplayProcessor';
import type { AgentRunMode } from '../../../types/agentRuntime';
import type { ChatMessage, ToolCallMetadata } from '../../../types/chat';
import { resolveRunMessageDisplay, type ThreadMessage, type ThreadToolCall } from '../../../types/thread';
import ThinkingDisplay from '../../../components/common/ThinkingDisplay';
import { FunctionCallsThread } from '../../../toolCall/ui';
import { SubAgentPeekDock } from '../../../components/SubAgentPeek';
import { TextButton } from '../../../components/TextButton';
import { IconButton } from '../../../components/IconButton';
import AgentRunModeToggle from '../../../components/ui/AgentRunModeToggle';
import { buildEditCardsFromToolCallMetadata } from '../../../toolCall';
import type { ToolCallDecisionMap } from '../../../toolCall/types';
import { Settings, Edit, Trash, Globe, CircularArrow, ChevronDown, Send, Stop } from '../../../components/icons';
import '../../../pages/workspace/styles/AgentPanel.css';
import '../../../pages/workspace/styles/AgentHeader.css';
import '../../../pages/workspace/styles/AgentMessages.css';
import '../../../pages/workspace/styles/MessageEdit.css';
import '../../../pages/workspace/styles/AgentInput.css';

const EMPTY_MESSAGES: ThreadMessage[] = [];

interface AgentPanelProps {
  projectId: string;
  surface?: string;
}

interface DisplayMessageInfo {
  source: ThreadMessage;
  chatMessage: ChatMessage;
  requestedLanguage: string;
  displayLanguage: string;
  hasRequestedLanguage: boolean;
  fallbackLanguage: string | null;
}

interface ToolCallBlockingSummary {
  count: number;
  firstMessageId?: string;
}

type DisplayItem =
  | { kind: 'message'; info: DisplayMessageInfo }
  | { kind: 'tool_group'; assistantMessageId: string; toolCalls: ThreadToolCall[]; messageIds: string[] };

type SendBlockReason = 'missing_agent' | 'running' | 'pending_tool_calls' | null;

interface SendBlockingState {
  blocked: boolean;
  reason: SendBlockReason;
  unresolvedToolCalls: ToolCallBlockingSummary;
}

interface AgentContextTriggerProps {
  selectedCount: number;
  totalCount: number;
  isOpen: boolean;
  onClick: () => void;
}

interface AgentInputFormProps {
  projectId: string;
  hasSelectedAgent: boolean;
  isLoading: boolean;
  isSendBlocked: boolean;
  sendBlockedReason?: string | null;
  onSubmit: (e: React.FormEvent, input: string) => Promise<void>;
  onStop: () => void;
}

const BLOCKING_TOOL_CALL_STATUSES = new Set(['pending', 'streaming', 'validating', 'processing']);

function isBlockingToolCallStatus(status: string | undefined): boolean {
  if (!status) return false;
  return BLOCKING_TOOL_CALL_STATUSES.has(status);
}

function summarizeToolCallBlocking(
  messageIds: string[],
  toolCallsByMessageId: Record<string, ThreadToolCall[] | undefined>,
  latestRunId?: string | null,
): ToolCallBlockingSummary {
  let count = 0;
  let firstMessageId: string | undefined;

  for (const messageId of messageIds) {
    const toolCalls = toolCallsByMessageId[messageId] ?? [];
    for (const toolCall of toolCalls) {
      // Only block sending for unresolved tool calls from the latest run.
      if (latestRunId && toolCall.runId && toolCall.runId !== latestRunId) continue;
      if (!isBlockingToolCallStatus(toolCall.status)) continue;
      count += 1;
      if (!firstMessageId) {
        firstMessageId = messageId;
      }
    }
  }

  return { count, firstMessageId };
}

function toToolCallMetadata(toolCall: ThreadToolCall): ToolCallMetadata {
  return {
    id: toolCall.id,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    status: toolCall.status as any,
    reason: toolCall.reason ?? undefined,
    failureType: toolCall.status === 'failed'
      ? (toolCall.reason?.startsWith('VALIDATION::') ? 'validation' : 'execution')
      : undefined,
    result: (toolCall.result ?? undefined) as any,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

function collapseContent(parts: Array<{ type: string; text: string }>): string {
  return parts
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('')
    .trim();
}

function hasNonEmptyPartText(message: ThreadMessage, partType: 'content' | 'thinking'): boolean {
  return Object.values(message.data).some((entry) => (
    entry.contentParts.some((part) => (
      part.type === partType && typeof part.text === 'string' && part.text.trim().length > 0
    ))
  ));
}

function hasThinkingDetails(message: ThreadMessage): boolean {
  return Object.values(message.data).some((entry) => (
    Array.isArray(entry.thinkingDetails) && entry.thinkingDetails.length > 0
  ));
}

function shouldDeleteAssistantMessageAfterToolCallCleanup(message: ThreadMessage): boolean {
  if (message.role !== 'assistant') return false;
  const hasContent = hasNonEmptyPartText(message, 'content');
  if (hasContent) return false;
  const hasThinking = hasNonEmptyPartText(message, 'thinking') || hasThinkingDetails(message);
  return !hasThinking;
}

const AgentContextTrigger: React.FC<AgentContextTriggerProps> = React.memo(({
  selectedCount,
  totalCount,
  isOpen,
  onClick,
}) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={`agent-context-dropdown-trigger ${isOpen ? 'open' : ''}`}
      onClick={onClick}
      aria-expanded={isOpen}
      aria-haspopup="listbox"
    >
      <span className={`agent-context-dropdown-arrow ${isOpen ? 'open' : ''}`}>
        <ChevronDown size="xs" />
      </span>
      <Settings size="sm" />
      <span>{t('agent.context')} ({selectedCount}/{totalCount})</span>
    </button>
  );
});

const AgentInputForm: React.FC<AgentInputFormProps> = React.memo(({
  projectId,
  hasSelectedAgent,
  isLoading,
  isSendBlocked,
  sendBlockedReason,
  onSubmit,
  onStop,
}) => {
  const { t } = useTranslation();
  const input = useAgentUIStore((state) => state.inputByProject[projectId] ?? '');
  const setInput = useAgentUIStore((state) => state.setInput);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    if (isLoading || isSendBlocked || !hasSelectedAgent) {
      e.preventDefault();
      return;
    }
    void onSubmit(e, input);
  }, [isLoading, isSendBlocked, hasSelectedAgent, onSubmit, input]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (isLoading || isSendBlocked || !hasSelectedAgent) return;
    void onSubmit(e as unknown as React.FormEvent, input);
  }, [isLoading, isSendBlocked, hasSelectedAgent, onSubmit, input]);

  return (
    <form onSubmit={handleSubmit} className="agent-form">
      {!isLoading && isSendBlocked && sendBlockedReason && (
        <div className="agent-send-blocker-hint" role="status">
          {sendBlockedReason}
        </div>
      )}
      <div className="input-group">
        <textarea
          value={input}
          onChange={(e) => setInput(projectId, e.target.value)}
          placeholder={t('agent.enterMessage')}
          rows={1}
          className="agent-input"
          onKeyDown={handleKeyDown}
        />
        {isLoading ? (
          <IconButton
            key="stop"
            icon={<Stop size="md" />}
            onClick={onStop}
            variant="danger"
            title={t('agent.stop')}
            className="agent-submit-btn"
          />
        ) : (
          <IconButton
            key="send"
            type="submit"
            icon={<Send size="md" />}
            variant="primary"
            title={t('agent.send')}
            className="agent-submit-btn"
            disabled={isSendBlocked || !hasSelectedAgent}
          />
        )}
      </div>
    </form>
  );
});

export const AgentPanel: React.FC<AgentPanelProps> = ({ projectId, surface }) => {
  const { t } = useTranslation();
  const settings = useSettings();
  const showError = useErrorStore((state) => state.showError);
  const sidebarStore = useSidebarStore();
  const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);
  const preferredDisplayLanguage = useDisplayLanguageStore((state) => state.preferredDisplayLanguage);
  const primaryLanguage = preferredDisplayLanguage || settings.mainLanguage;
  const secondaryLanguage = settings.defaultSubLanguage ?? undefined;

  const selectedAgentId = useAgentStore((state) => state.selectedAgentByProject[projectId]);
  const selectedAgent = useAgentStore((state) => state.getSelectedAgent(projectId));
  const markAgentViewed = useAgentUIStore((state) => state.markAgentViewed);
  const setAgentVisible = useAgentUIStore((state) => state.setAgentVisible);
  const agentVisibleState = useAgentUIStore((state) => state.agentVisibleByProject[projectId] ?? false);
  const preflightToast = useAgentUIStore((state) => state.preflightToastByProject[projectId] ?? null);
  const runMode = useAgentUIStore((state) => state.runModeByProject[projectId] ?? 'agentMode');
  const setRunMode = useAgentUIStore((state) => state.setRunMode);
  const setInput = useAgentUIStore((state) => state.setInput);
  const unifiedObjects = useUnifiedObjectStore((state) => state.objects);

  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window === 'undefined' ? true : window.innerWidth > 768
  ));
  const [isOverlayClosing, setIsOverlayClosing] = useState(false);
  const [isContextDropdownOpen, setIsContextDropdownOpen] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>([]);
  const [messageLanguageView, setMessageLanguageView] = useState<Record<string, 'primary' | 'secondary'>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingSaving, setEditingSaving] = useState(false);
  const [translatingByMessageId, setTranslatingByMessageId] = useState<Record<string, boolean>>({});

  const contextDropdownRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const isUserNearBottomRef = useRef(true);
  const hydratedThreadIdsRef = useRef<Set<string>>(new Set());

  const threadId = selectedAgent?.thread_id ?? null;
  const isAgentVisible = isDesktop ? true : agentVisibleState;

  const {
    thread,
    messages,
    toolCallsByMessageId,
  } = useThreadStore(
    useShallow((state) => ({
      thread: threadId ? state.threadsById[threadId] : undefined,
      messages: threadId ? state.messagesByThreadId[threadId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
      toolCallsByMessageId: state.toolCallsByMessageId,
    })),
  );

  const totalObjectCount = useMemo(() => (
    Object.values(unifiedObjects).filter((obj) => (
      obj.metadata?.project_id === projectId && obj.type !== 'basic_info'
    )).length
  ), [unifiedObjects, projectId]);

  const contextIdSet = useMemo(() => (
    new Set(
      Object.values(unifiedObjects)
        .filter((obj) => obj.metadata?.project_id === projectId && obj.type !== 'basic_info')
        .map((obj) => obj.id),
    )
  ), [unifiedObjects, projectId]);

  const isLoading = useMemo(() => {
    const status = thread?.status;
    return status === 'running' || status === 'waiting' || status === 'processing';
  }, [thread?.status]);

  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => a.seqInThread - b.seqInThread),
    [messages],
  );

  const displayItems = useMemo(() => {
    const items: DisplayItem[] = [];
    let i = 0;

    while (i < orderedMessages.length) {
      const msg = orderedMessages[i];

      if (msg.role === 'user' || msg.role === 'assistant') {
        const wantsSecondary = messageLanguageView[msg.id] === 'secondary' && Boolean(secondaryLanguage);
        const requestedLanguage = wantsSecondary && secondaryLanguage ? secondaryLanguage : primaryLanguage;
        const fallbackLanguage = wantsSecondary ? primaryLanguage : secondaryLanguage;

        const resolved = msg.isStreaming
          ? {
              contentParts: msg.streamingData?.contentParts ?? [],
              thinkingDetails: msg.streamingData?.thinkingDetails,
              displayLanguage: requestedLanguage,
              isFallback: false,
            }
          : resolveRunMessageDisplay(msg, requestedLanguage, fallbackLanguage);

        const chatMessage: ChatMessage = {
          id: msg.id,
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          contentParts: resolved.contentParts as any,
          thinking_details: resolved.thinkingDetails as any,
          timestamp: new Date(msg.createdAt),
        };

        items.push({
          kind: 'message',
          info: {
            source: msg,
            chatMessage,
            requestedLanguage,
            displayLanguage: resolved.displayLanguage,
            hasRequestedLanguage: !resolved.isFallback,
            fallbackLanguage: resolved.isFallback ? resolved.displayLanguage : null,
          },
        });
        i++;
      } else if (msg.role === 'tool_call') {
        const firstTcs = toolCallsByMessageId[msg.id] ?? [];
        const assistantMsgId = firstTcs[0]?.assistantMessageId ?? null;

        const groupToolCalls: ThreadToolCall[] = [...firstTcs];
        const groupMessageIds: string[] = [msg.id];

        let j = i + 1;
        while (j < orderedMessages.length && orderedMessages[j].role === 'tool_call') {
          const nextTcs = toolCallsByMessageId[orderedMessages[j].id] ?? [];
          const nextAssistantId = nextTcs[0]?.assistantMessageId ?? null;
          if (nextAssistantId !== assistantMsgId) break;
          groupToolCalls.push(...nextTcs);
          groupMessageIds.push(orderedMessages[j].id);
          j++;
        }

        if (groupToolCalls.length > 0) {
          items.push({
            kind: 'tool_group',
            assistantMessageId: assistantMsgId ?? '',
            toolCalls: groupToolCalls,
            messageIds: groupMessageIds,
          });
        }
        i = j;
      } else {
        i++;
      }
    }

    return items;
  }, [orderedMessages, toolCallsByMessageId, messageLanguageView, primaryLanguage, secondaryLanguage]);

  const lastAssistantMessageId = useMemo(() => {
    for (let i = orderedMessages.length - 1; i >= 0; i--) {
      const msg = orderedMessages[i];
      if (msg.role === 'assistant' && !msg.isStreaming) {
        return msg.id;
      }
    }
    return null;
  }, [orderedMessages]);

  const sendBlockingState: SendBlockingState = useMemo(() => {
    const missingAgent = !selectedAgentId;
    const unresolvedToolCalls = summarizeToolCallBlocking(
      orderedMessages.map((message) => message.id),
      toolCallsByMessageId,
      thread?.latestRunId ?? null,
    );
    const running = isLoading;

    let reason: SendBlockReason = null;
    if (missingAgent) {
      reason = 'missing_agent';
    } else if (unresolvedToolCalls.count > 0) {
      reason = 'pending_tool_calls';
    } else if (running) {
      reason = 'running';
    }

    return {
      blocked: missingAgent || running || unresolvedToolCalls.count > 0,
      reason,
      unresolvedToolCalls,
    };
  }, [selectedAgentId, orderedMessages, toolCallsByMessageId, isLoading, thread?.latestRunId]);

  const sendBlockedReason = useMemo(() => {
    if (!sendBlockingState.blocked || !sendBlockingState.reason) return null;
    if (sendBlockingState.reason === 'missing_agent') {
      return 'Select an agent before sending a message.';
    }
    if (sendBlockingState.reason === 'pending_tool_calls') {
      return `Resolve ${sendBlockingState.unresolvedToolCalls.count} pending operation(s) before sending.`;
    }
    if (sendBlockingState.reason === 'running') {
      return 'The agent is still running or applying operations.';
    }
    return 'Resolve pending operations before sending.';
  }, [sendBlockingState]);

  const hasStreamingMessage = useMemo(
    () => orderedMessages.some((message) => message.isStreaming),
    [orderedMessages],
  );

  const latestRunError = useMemo(() => {
    if (thread?.status !== 'error') return undefined;
    if (displayItems.length === 0) return undefined;
    return thread.lastError || 'An error occurred during generation.';
  }, [thread?.status, thread?.lastError, displayItems.length]);

  useEffect(() => {
    if (!projectId || !selectedAgentId) return;
    markAgentViewed(projectId, selectedAgentId);
  }, [projectId, selectedAgentId, markAgentViewed]);

  useEffect(() => {
    setMessageLanguageView({});
  }, [selectedAgentId]);

  useEffect(() => {
    setEditingMessageId(null);
    setEditingText('');
    setTranslatingByMessageId({});
  }, [selectedAgentId, threadId]);

  useEffect(() => {
    hydratedThreadIdsRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    if (!threadId) return;

    const store = useThreadStore.getState();
    const existingMessages = store.getMessages(threadId);
    if (hydratedThreadIdsRef.current.has(threadId) || existingMessages.length > 0) {
      hydratedThreadIdsRef.current.add(threadId);
      return;
    }

    let cancelled = false;
    void threadService
      .listMessages(threadId)
      .then((response) => {
        if (cancelled) return;
        const nextStore = useThreadStore.getState();
        nextStore.upsertThread(response.thread);
        for (const msg of response.messages) {
          nextStore.upsertMessage(msg);
        }
        for (const tc of response.toolCalls) {
          nextStore.upsertToolCall(tc);
        }
        hydratedThreadIdsRef.current.add(threadId);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Failed to hydrate thread messages', { threadId, error });
      });

    return () => {
      cancelled = true;
    };
  }, [threadId]);

  useEffect(() => {
    if (selectedContextIds.length === 0) return;
    setSelectedContextIds((prev) => prev.filter((id) => contextIdSet.has(id)));
  }, [contextIdSet, selectedContextIds.length]);

  useEffect(() => {
    const handleResize = () => setIsDesktop(window.innerWidth > 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isContextDropdownOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!contextDropdownRef.current?.contains(event.target as Node)) {
        setIsContextDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsContextDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isContextDropdownOpen]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const threshold = 100;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    isUserNearBottomRef.current = isNearBottom;
    setShowScrollButton(!isNearBottom && isLoading);
  }, [isLoading]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !isUserNearBottomRef.current) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
  }, [displayItems.length, hasStreamingMessage, isLoading]);

  useEffect(() => {
    if (!isLoading) {
      setShowScrollButton(false);
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [isLoading]);

  const formatTimestamp = useCallback((input: Date | string | number | undefined | null) => {
    if (!input) return '';

    const date = input instanceof Date ? input : new Date(input);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString();
  }, []);

  const scrollToFirstBlockedMessage = useCallback(() => {
    const firstMessageId = sendBlockingState.unresolvedToolCalls.firstMessageId;
    if (!firstMessageId || !scrollContainerRef.current) return;

    const target = scrollContainerRef.current.querySelector(
      `[data-function-call-message-id="${firstMessageId}"]`,
    );
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [sendBlockingState.unresolvedToolCalls.firstMessageId]);

  const handleSubmit = useCallback(async (e: React.FormEvent, inputText: string) => {
    e.preventDefault();
    if (!threadId) return;

    const shouldClear = inputText.trim().length > 0;
    await sendThreadMessage({
      threadId,
      projectId,
      threadType: 'agent',
      inputText,
      request: {
        run_mode: runMode,
        surface,
        context_object_ids: selectedContextIds,
      },
    });
    if (shouldClear) {
      setInput(projectId, '');
    }
  }, [threadId, runMode, surface, selectedContextIds, setInput, projectId]);

  const handleSubmitFromInput = useCallback(async (e: React.FormEvent, inputText: string) => {
    if (isLoading) {
      e.preventDefault();
      return;
    }
    if (sendBlockingState.blocked) {
      e.preventDefault();
      scrollToFirstBlockedMessage();
      if (sendBlockedReason) {
        showError('Cannot Send', sendBlockedReason);
      }
      return;
    }
    await handleSubmit(e, inputText);
  }, [
    isLoading,
    sendBlockingState.blocked,
    scrollToFirstBlockedMessage,
    sendBlockedReason,
    showError,
    handleSubmit,
  ]);

  const handleStop = useCallback(() => {
    if (!threadId) return;
    void cancelThread({ threadId }).catch((error) => {
      console.error('Failed to cancel run:', error);
    });
  }, [threadId]);

  const handleCommitDecisions = useCallback(async (decisions: ToolCallDecisionMap) => {
    if (!threadId) return;
    const accepts = Object.entries(decisions)
      .filter(([, decision]) => decision === 'accept')
      .map(([id]) => id);
    const rejects = Object.entries(decisions)
      .filter(([, decision]) => decision === 'reject')
      .map(([id]) => id);

    if (accepts.length > 1 && rejects.length === 0) {
      await decideToolCallsBatch({
        threadId,
        decisions: accepts.map((id) => ({ toolCallId: id, decision: 'accept' })),
      });
      return;
    }

    await Promise.all([
      ...accepts.map((id) => decideToolCall({ threadId, toolCallId: id, decision: 'accept' })),
      ...rejects.map((id) => decideToolCall({ threadId, toolCallId: id, decision: 'reject' })),
    ]);
  }, [threadId]);

  const handleStartMessageEdit = useCallback((messageId: string, currentText: string) => {
    setEditingMessageId(messageId);
    setEditingText(currentText);
  }, []);

  const handleCancelMessageEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleSaveMessageEdit = useCallback(async (message: ThreadMessage) => {
    if (!threadId || !editingMessageId || editingSaving) return;
    const content = editingText.trim();
    if (!content) return;

    setEditingSaving(true);
    const state = useThreadStore.getState();
    const existing = state.getMessages(threadId).find((m) => m.id === message.id);
    const entry = {
      contentParts: [{ type: 'content' as const, text: content }],
      thinkingDetails: [],
    };

    if (existing) {
      state.patchMessage(threadId, message.id, {
        data: {
          ...(existing.data ?? {}),
          [primaryLanguage]: entry,
        },
      });
    }

    try {
      await threadService.updateMessage(threadId, message.id, {
        language: primaryLanguage,
        content_parts: entry.contentParts,
        thinking_details: entry.thinkingDetails,
        set_final: true,
      });
      setEditingMessageId(null);
      setEditingText('');
    } catch (error: any) {
      showError('Edit Failed', error?.message ?? 'Failed to update message.');
    } finally {
      setEditingSaving(false);
    }
  }, [threadId, editingMessageId, editingSaving, editingText, primaryLanguage, showError]);

  const handleTranslateMessage = useCallback(async (message: ThreadMessage, sourceContent: string) => {
    if (!threadId || !secondaryLanguage) return;
    const text = sourceContent.trim();
    if (!text) return;
    if (translatingByMessageId[message.id]) return;

    setTranslatingByMessageId((prev) => ({ ...prev, [message.id]: true }));
    try {
      await runMessageTranslation({
        projectId,
        sourceThreadId: threadId,
        sourceMessageId: message.id,
        sourceLanguage: primaryLanguage,
        targetLanguage: secondaryLanguage,
        sourceContent: text,
      });
    } catch (error: any) {
      showError('Translation Failed', error?.message ?? 'Failed to translate message.');
    } finally {
      setTranslatingByMessageId((prev) => ({ ...prev, [message.id]: false }));
    }
  }, [threadId, projectId, primaryLanguage, secondaryLanguage, showError, translatingByMessageId]);

  const handleDeleteSingleToolCall = useCallback(async (toolCallId: string) => {
    if (!threadId) {
      showError('Delete Failed', 'Could not find the thread.');
      return;
    }
    if (!window.confirm('Are you sure you want to delete this tool call?')) return;

    const state = useThreadStore.getState();
    const tc = state.toolCallsById[toolCallId];
    if (!tc) return;
    const assistantMessageId = tc.assistantMessageId;

    // Local cleanup first (optimistic)
    if (tc.messageId) state.removeMessage(threadId, tc.messageId);
    state.removeToolCall(toolCallId);

    // Remove the assistant message when its last tool call is removed and
    // it has neither content nor thinking.
    if (assistantMessageId) {
      const nextState = useThreadStore.getState();
      const remainingToolCalls = nextState
        .getToolCallsForAssistantMessage(assistantMessageId)
        .filter((linkedTc) => linkedTc.threadId === threadId);

      if (remainingToolCalls.length === 0) {
        const assistantMessage = nextState
          .getMessages(threadId)
          .find((msg) => msg.id === assistantMessageId && msg.role === 'assistant');
        if (assistantMessage && shouldDeleteAssistantMessageAfterToolCallCleanup(assistantMessage)) {
          nextState.removeMessage(threadId, assistantMessageId);
        }
      }
    }

    // Backend — deleteToolCall cascades to messages via parent_tool_call_id FK
    if (isUuid(toolCallId)) {
      try {
        await threadService.deleteToolCall(threadId, toolCallId);
      } catch (error) {
        console.error('Failed to delete tool call:', error);
      }
    }
  }, [threadId, showError]);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!threadId) {
      showError('Delete Failed', 'Could not find the thread.');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this message?')) return;

    const state = useThreadStore.getState();

    // Find all tool calls linked to this message (via any of the three ID fields)
    const linkedToolCalls = Object.values(state.toolCallsById)
      .filter((tc): tc is ThreadToolCall => Boolean(tc))
      .filter((tc) => tc.threadId === threadId && (
        tc.assistantMessageId === messageId
        || tc.messageId === messageId
      ));

    // Local cleanup first (optimistic)
    for (const tc of linkedToolCalls) {
      if (tc.messageId) state.removeMessage(threadId, tc.messageId);
      state.removeToolCall(tc.id);
    }
    state.removeMessage(threadId, messageId);

    // Backend — for assistant messages, DB cascade handles everything:
    // assistant_message_id CASCADE → deletes tool calls → parent_tool_call_id CASCADE → deletes their messages
    if (isUuid(messageId)) {
      try {
        await threadService.deleteMessage(threadId, messageId);
      } catch (error) {
        console.error('Failed to delete message:', error);
      }
    }
  }, [threadId, showError]);

  const handleCloseAgent = useCallback(() => {
    setIsOverlayClosing(true);
    setAgentVisible(projectId, false);
  }, [projectId, setAgentVisible]);

  const handleOverlayAnimationEnd = useCallback((e: React.AnimationEvent) => {
    if (e.animationName === 'overlayFadeOut') {
      setIsOverlayClosing(false);
      setAgentVisible(projectId, false);
    }
  }, [projectId, setAgentVisible]);

  const handleSelectAgentFromSidebar = useCallback(() => {
    useSidebarStore.getState().closeSidebar(projectId);
  }, [projectId]);

  return (
    <div className={`agent-panel ${isAgentVisible ? 'visible' : 'hidden'}`}>
      <div className="agent-header">
        <div className="agent-header-left">
          <TextButton
            variant="secondary"
            size="sm"
            onClick={() => sidebarStore.toggleSidebar(projectId, 'agent')}
            title={t('agent.viewAgentList')}
          >
            {t('agent.agents')}
          </TextButton>
          <h2>{selectedAgent?.name || t('agent.aiAgent')}</h2>
        </div>
        <TextButton
          variant="secondary"
          size="sm"
          className="mobile-only"
          onClick={() => setAgentVisible(projectId, false)}
        >
          {t('agent.close')}
        </TextButton>
      </div>

      <div className="agent-messages" ref={scrollContainerRef}>
        {displayItems.length === 0 && (
          <div className="welcome-message">
            <div className="ai-avatar">{t('agent.ai')}</div>
            <div className="message-content">
              <p>{t('agent.welcomeMessage')}</p>
            </div>
          </div>
        )}

        {displayItems.map((item, index) => {
          if (item.kind === 'tool_group') {
            const hasSubAgentCalls = item.toolCalls.some((tc) => (
              tc.toolName.startsWith('call_') && Boolean(tc.childThreadId)
            ));
            const isActiveSubAgentParent = item.assistantMessageId === lastAssistantMessageId;
            const showRunError = Boolean(latestRunError) && index === displayItems.length - 1;

            const allCards = buildEditCardsFromToolCallMetadata(
              item.toolCalls.map(toToolCallMetadata),
            );
            const hasAnyPending = item.toolCalls.some((tc) => isBlockingToolCallStatus(tc.status));
            const groupMode = hasAnyPending ? 'pending' : 'confirmed';

            return (
              <React.Fragment key={`toolgroup:${item.messageIds[0]}`}>
                {allCards.length > 0 && (
                  <div className="agent-tool-group">
                    {item.messageIds.map((mid) => (
                      <span key={mid} data-function-call-message-id={mid} />
                    ))}
                    <FunctionCallsThread
                      threadId={`agent:${selectedAgentId ?? 'none'}:tg:${item.assistantMessageId}`}
                      mode={groupMode}
                      cards={allCards}
                      onCommitDecisions={groupMode === 'pending' ? handleCommitDecisions : undefined}
                      onDeleteCard={(cardId) => void handleDeleteSingleToolCall(cardId)}
                      projectId={projectId}
                    />
                  </div>
                )}

                {selectedAgentId && hasSubAgentCalls && threadId && (
                  <SubAgentPeekDock
                    parentThreadId={threadId}
                    parentMessageId={item.assistantMessageId}
                    projectId={projectId}
                    isActiveParent={isActiveSubAgentParent}
                  />
                )}

                {showRunError && (
                  <div className="message-error">{latestRunError}</div>
                )}
              </React.Fragment>
            );
          }

          const message = item.info;
          let prevMessageItem: DisplayItem | null = null;
          for (let j = index - 1; j >= 0; j--) {
            if (displayItems[j].kind === 'message') {
              prevMessageItem = displayItems[j];
              break;
            }
          }
          const isSameRoleAsPrevious = prevMessageItem?.kind === 'message'
            && prevMessageItem.info.chatMessage.role === message.chatMessage.role;
          const isUser = message.chatMessage.role === 'user';
          const isStreamingMessage = message.source.isStreaming === true;

          const processed = displayProcessor.process(
            message.chatMessage as any,
            { projectId, surface: (surface ?? 'story-object') as any },
          );

          const showRunError = Boolean(latestRunError) && index === displayItems.length - 1;
          const translationAvailable = secondaryLanguage
            ? Boolean(message.source.data[secondaryLanguage])
            : false;
          const translating = Boolean(translatingByMessageId[message.source.id]);
          const isEditing = editingMessageId === message.source.id;
          const primaryEntry = message.source.data[primaryLanguage];
          const primaryPlainContent = collapseContent(
            primaryEntry?.contentParts ?? message.chatMessage.contentParts,
          );

          return (
            <React.Fragment key={message.chatMessage.id}>
              <div className={`agent-message ${message.chatMessage.role}${isSameRoleAsPrevious ? ' same-role-as-previous' : ''}`}>
                <div className="message-wrapper">
                  {!isSameRoleAsPrevious && (
                    <div className="message-header">
                      <span className="message-role">{isUser ? t('agent.you') : t('agent.ai')}</span>
                      <span className="message-time">{formatTimestamp(message.chatMessage.timestamp)}</span>
                    </div>
                  )}

                  {message.chatMessage.role === 'assistant' && !isEditing && (
                    <ThinkingDisplay
                      messageId={message.chatMessage.id}
                      contentParts={message.chatMessage.contentParts}
                      isStreaming={isStreamingMessage}
                    />
                  )}

                  {!isEditing && (primaryPlainContent || isStreamingMessage) && (
                    <div className="message-content">
                      {!message.hasRequestedLanguage && (
                        <div className="language-fallback-badge">
                          {t('agent.usingLanguage', {
                            language: message.fallbackLanguage || message.displayLanguage,
                          })}
                        </div>
                      )}
                      {processed.displayContent}
                      {isStreamingMessage && thread?.status === 'running' && (
                        <div className="typing-indicator inline">
                          <div className="loading-track">
                            <div className="loading-bar" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {isEditing && (
                    <div className="message-edit">
                      <textarea
                        value={editingText}
                        onChange={(event) => setEditingText(event.target.value)}
                        autoFocus
                      />
                      <div className="edit-actions">
                        <TextButton
                          variant="secondary"
                          onClick={handleCancelMessageEdit}
                          disabled={editingSaving}
                        >
                          {t('agent.cancel')}
                        </TextButton>
                        <TextButton
                          variant="primary"
                          onClick={() => void handleSaveMessageEdit(message.source)}
                          disabled={editingSaving || !editingText.trim()}
                        >
                          {editingSaving ? t('common.loading') : t('agent.save')}
                        </TextButton>
                      </div>
                    </div>
                  )}

                  {showRunError && (
                    <div className="message-error">
                      {latestRunError}
                    </div>
                  )}

                  {!isStreamingMessage && !isEditing && (
                    <div className="message-actions">
                      <div className="action-buttons">
                        {translationAvailable && secondaryLanguage && (
                          <IconButton
                            icon={<Globe size="sm" />}
                            variant="ghost"
                            size="sm"
                            isActive={messageLanguageView[message.source.id] === 'secondary'}
                            onClick={() => setMessageLanguageView((prev) => ({
                              ...prev,
                              [message.source.id]: prev[message.source.id] === 'secondary' ? 'primary' : 'secondary',
                            }))}
                            title={messageLanguageView[message.source.id] === 'secondary'
                              ? t('agent.switchToLanguage', { language: primaryLanguage })
                              : t('agent.switchToLanguage', { language: secondaryLanguage })}
                          />
                        )}
                        {!isUser && secondaryLanguage && (
                          <IconButton
                            icon={translating ? <CircularArrow size="sm" /> : (translationAvailable ? <CircularArrow size="sm" /> : <Globe size="sm" />)}
                            onClick={() => void handleTranslateMessage(message.source, primaryPlainContent)}
                            title={translationAvailable
                              ? t('agent.refreshTranslation', { language: secondaryLanguage })
                              : t('agent.translateTo', { language: secondaryLanguage })}
                            variant="ghost"
                            size="sm"
                            disabled={translating || !primaryPlainContent}
                          />
                        )}
                        <IconButton
                          icon={<Edit size="sm" />}
                          onClick={() => handleStartMessageEdit(message.source.id, primaryPlainContent)}
                          disabled={!primaryPlainContent}
                          title={t('agent.edit')}
                          variant="ghost"
                          size="sm"
                        />
                        <IconButton
                          icon={<Trash size="sm" />}
                          onClick={() => void handleDeleteMessage(message.chatMessage.id)}
                          title={t('agent.delete')}
                          variant="ghost"
                          size="sm"
                          className="icon-button--ghost-danger"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {thread?.memoryBoundaryMessageId === message.source.id && (
                <div className="agent-archive-divider" role="separator" aria-label="Memory boundary">
                  <div className="agent-archive-divider-line" />
                  <span className="agent-archive-divider-label">Memory boundary</span>
                  <div className="agent-archive-divider-line" />
                </div>
              )}
            </React.Fragment>
          );
        })}

        {isLoading && !hasStreamingMessage && thread?.status === 'running' && (
          <div className="typing-indicator">
            <div className="loading-track">
              <div className="loading-bar" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />

        {showScrollButton && (
          <IconButton
            className="scroll-to-bottom-button"
            icon={<ChevronDown size="sm" />}
            onClick={() => {
              const container = scrollContainerRef.current;
              if (!container) return;
              isUserNearBottomRef.current = true;
              container.scrollTo({
                top: container.scrollHeight,
                behavior: 'smooth',
              });
              setShowScrollButton(false);
            }}
            title={t('agent.scrollToBottom')}
            variant="primary"
          />
        )}
      </div>

      <div className="agent-input-container" ref={contextDropdownRef}>
        {preflightToast && (
          <div
            className={`agent-preflight-toast ${preflightToast.type === 'error' ? 'agent-preflight-toast--error' : ''}`}
            role={preflightToast.type === 'error' ? 'alert' : 'status'}
          >
            {preflightToast.message}
          </div>
        )}

        <div className={`agent-context-dropdown-menu ${isContextDropdownOpen ? '' : 'hidden'}`}>
          <ObjectPicker
            mode="all"
            selectionMode="multi"
            selectedIds={selectedContextIds}
            onChange={(ids) => setSelectedContextIds(ids as string[])}
            projectId={projectId}
            language={primaryLanguage}
            maxHeight="350px"
            showSearch={true}
            showSelectAll={true}
            showTokenCount={true}
          />
        </div>

        <div className="agent-controls-row">
          <AgentRunModeToggle
            currentRunMode={runMode as AgentRunMode}
            onRunModeChange={(next) => setRunMode(projectId, next)}
          />
          <AgentContextTrigger
            selectedCount={selectedContextIds.length}
            totalCount={totalObjectCount}
            isOpen={isContextDropdownOpen}
            onClick={() => setIsContextDropdownOpen((prev) => !prev)}
          />
        </div>

        <AgentInputForm
          projectId={projectId}
          hasSelectedAgent={Boolean(selectedAgentId && threadId)}
          isLoading={isLoading}
          isSendBlocked={sendBlockingState.blocked}
          sendBlockedReason={sendBlockedReason}
          onSubmit={handleSubmitFromInput}
          onStop={handleStop}
        />
      </div>

      <AgentSidebar
        projectId={projectId}
        onSelectAgent={handleSelectAgentFromSidebar}
      />

      {(isAgentVisible || isOverlayClosing) && createPortal(
        <div
          className={`agent-overlay mobile-only ${isOverlayClosing ? 'closing' : ''}`}
          onClick={handleCloseAgent}
          onAnimationEnd={handleOverlayAnimationEnd}
        />,
        document.getElementById('root') || document.body,
      )}
    </div>
  );
};

export default AgentPanel;

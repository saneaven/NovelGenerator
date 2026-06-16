import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { ChatMessage, ToolCallMetadata } from '../../types/chat';
import type { McpSelectionAudit } from '../../types/mcp';
import type { ThreadInfo, ThreadMessage, ThreadStatus, ThreadToolCall } from '../../types/thread';
import { resolveRunMessageDisplay } from '../../types/thread';
import { threadService } from '../../api/threadService';
import { DefaultDisplayProcessor } from '../../agent/processors/DisplayProcessor';
import { runMessageTranslation } from '../../agent/messageTranslation';
import { useUiStore } from '../../store/uiStore';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import { alert as showAlert, confirm } from '../../store/dialogStore';
import {
  refetchThreadSnapshot,
  patchSnapshotMessage,
  removeSnapshotMessage,
  removeSnapshotToolCall,
  getMergedThreadView,
  getMergedThreadMessages,
} from '../../data/threads';
import { applyOptimisticDeletePause, getThreadDeletePauseContext } from '../../runtime/threadDeleteState';
import { hasRenderableAssistantOutput } from '../../runtime/messageVisibility';
import { isUuid } from '../../utils/idUtils';
import { BaseModal } from '../BaseModal';
import { TextButton } from '../TextButton';

export interface ThreadMessageDisplayItem {
  message: ThreadMessage;
  role: 'user' | 'assistant';
  chatMessage: ChatMessage;
  displayContent: React.ReactNode;
  bodyText: string;
  primaryText: string;
  requestedLanguage: string;
  displayLanguage: string;
  isSecondaryView: boolean;
  translationAvailable: boolean;
  isStreaming: boolean;
  toolCalls: ThreadToolCall[];
  toolCallMessageIds: string[];
  mcpSelections: McpSelectionAudit[];
}

interface UseThreadMessageRowsOptions {
  threadId: string;
  projectId: string;
  messages: ThreadMessage[];
  toolCallsById: Record<string, ThreadToolCall | undefined>;
  toolCallIdsByAssistantMessageId: Record<string, string[] | undefined>;
  sourceLanguage: string;
  secondaryLanguage?: string;
  messageLanguageView: Record<string, 'primary' | 'secondary' | undefined>;
  onMessageTranslationComplete?: (messageId: string) => void;
}

interface ActiveMessageTranslationRun {
  sourceMessageId: string;
  targetLanguage: string;
  hadTargetLanguageAtStart: boolean;
  journeyId?: string;
  journeyThreadId?: string;
}

const EMPTY_ACTIVE_JOURNEY_THREADS: Record<string, ThreadInfo | undefined> = {};

function toToolCallMetadata(toolCall: ThreadToolCall): ToolCallMetadata {
  return {
    id: toolCall.id,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    extra_content: toolCall.extraContent ?? undefined,
    status: toolCall.status as any,
    reason: toolCall.reason ?? undefined,
    imageRunId: toolCall.imageRunId ?? undefined,
    failureType: toolCall.status === 'failed'
      ? (toolCall.reason?.startsWith('VALIDATION::') ? 'validation' : 'execution')
      : undefined,
    result: (toolCall.result ?? undefined) as any,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

export function collapseContent(parts: Array<{ type: string; text: string }>): string {
  return parts
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('')
    .trim();
}

export function getMessageMcpSelections(message: ThreadMessage): McpSelectionAudit[] {
  for (const entry of Object.values(message.data)) {
    const selections = entry.meta?.mcpSelections;
    if (Array.isArray(selections) && selections.length > 0) {
      return selections;
    }
  }
  return [];
}

function getPrimaryContentParts(message: ThreadMessage, sourceLanguage: string): Array<{ type: 'content'; text: string }> {
  if (message.isStreaming) {
    return message.streamingData?.contentParts ?? [];
  }
  const entry = message.data[sourceLanguage]
    ?? Object.values(message.data ?? {}).find((value) => value && typeof value === 'object');
  return entry?.contentParts ?? [];
}

function uniqueMessageIds(toolCalls: ThreadToolCall[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const toolCall of toolCalls) {
    if (!toolCall.messageId || seen.has(toolCall.messageId)) continue;
    seen.add(toolCall.messageId);
    ids.push(toolCall.messageId);
  }
  return ids;
}

function isTerminalMessageTranslationStatus(status: ThreadStatus): boolean {
  return status === 'error' || status === 'canceled' || status === 'done';
}

export function useThreadMessageRows({
  threadId,
  projectId,
  messages,
  toolCallsById,
  toolCallIdsByAssistantMessageId,
  sourceLanguage,
  secondaryLanguage,
  messageLanguageView,
  onMessageTranslationComplete,
}: UseThreadMessageRowsOptions) {
  const { t } = useTranslation();
  const displayProcessor = useMemo(() => new DefaultDisplayProcessor(), []);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [editingSaving, setEditingSaving] = useState(false);
  const [translatingByMessageId, setTranslatingByMessageId] = useState<Record<string, ActiveMessageTranslationRun | undefined>>({});

  const messagesById = useMemo(() => {
    const next: Record<string, ThreadMessage | undefined> = {};
    for (const message of messages) {
      next[message.id] = message;
    }
    return next;
  }, [messages]);

  const activeJourneyThreadIds = useMemo(() => {
    const ids = new Set<string>();
    for (const run of Object.values(translatingByMessageId)) {
      if (run?.journeyThreadId) ids.add(run.journeyThreadId);
    }
    return [...ids];
  }, [translatingByMessageId]);

  const activeJourneyThreads = useThreadStreamStore(useShallow((state) => {
    if (activeJourneyThreadIds.length === 0) return EMPTY_ACTIVE_JOURNEY_THREADS;
    const next: Record<string, ThreadInfo | undefined> = {};
    for (const journeyThreadId of activeJourneyThreadIds) {
      next[journeyThreadId] = state.threadsById[journeyThreadId];
    }
    return next;
  }));

  useEffect(() => {
    setEditingMessageId(null);
    setEditingText('');
    setEditingSaving(false);
    setTranslatingByMessageId({});
  }, [threadId, sourceLanguage, secondaryLanguage]);

  useEffect(() => {
    if (!secondaryLanguage) setTranslatingByMessageId({});
  }, [secondaryLanguage]);

  const showTranslationErrorToast = useCallback((message: string) => {
    useUiStore.getState().showPreflightToast(projectId, {
      type: 'error',
      message,
    });
  }, [projectId]);

  const buildTranslationFailedMessage = useCallback((errorMessage?: string | null) => {
    const baseMessage = t('agent.messageTranslationFailed');
    const trimmedError = typeof errorMessage === 'string' ? errorMessage.trim() : '';
    return trimmedError ? `${baseMessage}: ${trimmedError}` : baseMessage;
  }, [t]);

  useEffect(() => {
    const completedMessageIds = new Set<string>();
    const successfulMessageIds = new Set<string>();
    const failureMessages: string[] = [];

    for (const [messageId, run] of Object.entries(translatingByMessageId)) {
      if (!run) continue;

      const message = messagesById[run.sourceMessageId];
      if (!message) {
        completedMessageIds.add(messageId);
        continue;
      }

      const hasTargetLanguageData = Boolean(message.data[run.targetLanguage]);
      if (!run.hadTargetLanguageAtStart && hasTargetLanguageData) {
        completedMessageIds.add(messageId);
        successfulMessageIds.add(messageId);
        continue;
      }

      if (!run.journeyThreadId) continue;
      const journeyThread = activeJourneyThreads[run.journeyThreadId];
      if (!journeyThread || !isTerminalMessageTranslationStatus(journeyThread.status)) continue;

      completedMessageIds.add(messageId);
      if (journeyThread.status === 'canceled') {
        failureMessages.push(t('agent.messageTranslationCanceled'));
      } else if (journeyThread.status === 'error') {
        failureMessages.push(buildTranslationFailedMessage(journeyThread.lastError));
      } else if (!hasTargetLanguageData) {
        failureMessages.push(buildTranslationFailedMessage());
      } else {
        successfulMessageIds.add(messageId);
      }
    }

    if (completedMessageIds.size === 0) return;

    setTranslatingByMessageId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const messageId of completedMessageIds) {
        if (!next[messageId]) continue;
        delete next[messageId];
        changed = true;
      }
      return changed ? next : prev;
    });

    const latestFailureMessage = failureMessages[failureMessages.length - 1];
    if (latestFailureMessage) {
      showTranslationErrorToast(latestFailureMessage);
    }

    for (const messageId of successfulMessageIds) {
      onMessageTranslationComplete?.(messageId);
    }
  }, [
    activeJourneyThreads,
    buildTranslationFailedMessage,
    messagesById,
    onMessageTranslationComplete,
    showTranslationErrorToast,
    t,
    translatingByMessageId,
  ]);

  const orderedMessages = useMemo(
    () => [...messages].sort((a, b) => {
      if (a.seqInThread !== b.seqInThread) return a.seqInThread - b.seqInThread;
      return a.createdAt.localeCompare(b.createdAt);
    }),
    [messages],
  );

  const rows = useMemo<ThreadMessageDisplayItem[]>(() => {
    const items: ThreadMessageDisplayItem[] = [];

    for (const message of orderedMessages) {
      if (message.role !== 'user' && message.role !== 'assistant') continue;
      const translationAvailable = secondaryLanguage ? Boolean(message.data[secondaryLanguage]) : false;
      const wantsSecondary = messageLanguageView[message.id] === 'secondary' && translationAvailable;
      const requestedLanguage = wantsSecondary && secondaryLanguage ? secondaryLanguage : sourceLanguage;
      const fallbackLanguage = wantsSecondary ? sourceLanguage : secondaryLanguage;

      const toolCalls = message.role === 'assistant'
        ? (toolCallIdsByAssistantMessageId[message.id] ?? [])
          .map((id) => toolCallsById[id])
          .filter((toolCall): toolCall is ThreadToolCall => Boolean(toolCall))
          .filter((toolCall) => toolCall.toolName.trim().length > 0)
          .sort((a, b) => a.callSeq - b.callSeq)
        : [];

      if (message.role === 'assistant' && !hasRenderableAssistantOutput({
        message,
        language: requestedLanguage,
        fallbackLanguage: fallbackLanguage ?? undefined,
        toolCalls,
      })) {
        continue;
      }

      const resolved = message.isStreaming
        ? {
            contentParts: message.streamingData?.contentParts ?? [],
            reasoningDetail: message.streamingData?.reasoningDetail,
            displayLanguage: requestedLanguage,
            isFallback: false,
          }
        : resolveRunMessageDisplay(message, requestedLanguage, fallbackLanguage);

      const chatMessage: ChatMessage = {
        id: message.id,
        role: message.role,
        contentParts: resolved.contentParts as any,
        reasoning_detail: resolved.reasoningDetail as any,
        timestamp: new Date(message.createdAt),
      };

      const bodyText = collapseContent(resolved.contentParts);
      const primaryText = collapseContent(getPrimaryContentParts(message, sourceLanguage));
      const processed = displayProcessor.process(chatMessage as any);

      items.push({
        message,
        role: message.role,
        chatMessage,
        displayContent: processed.displayContent,
        bodyText,
        primaryText,
        requestedLanguage,
        displayLanguage: resolved.displayLanguage,
        isSecondaryView: wantsSecondary,
        translationAvailable,
        isStreaming: message.isStreaming === true,
        toolCalls,
        toolCallMessageIds: uniqueMessageIds(toolCalls),
        mcpSelections: getMessageMcpSelections(message),
      });
    }

    return items;
  }, [
    displayProcessor,
    messageLanguageView,
    orderedMessages,
    secondaryLanguage,
    sourceLanguage,
    toolCallIdsByAssistantMessageId,
    toolCallsById,
  ]);

  const startEdit = useCallback((messageId: string, currentText: string) => {
    setEditingMessageId(messageId);
    setEditingText(currentText);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!threadId || !editingMessageId || editingSaving) return;
    const content = editingText.trim();
    if (!content) return;

    const existing = getMergedThreadMessages(threadId).find((message) => message.id === editingMessageId);
    if (!existing) {
      cancelEdit();
      return;
    }

    const existingEntry = existing.data?.[sourceLanguage]
      ?? Object.values(existing.data ?? {}).find((value) => value && typeof value === 'object');
    const entry = {
      contentParts: [
        { type: 'content' as const, text: content },
      ],
      reasoningDetail: existingEntry?.reasoningDetail,
    };

    setEditingSaving(true);
    patchSnapshotMessage(threadId, editingMessageId, {
      data: {
        ...(existing.data ?? {}),
        [sourceLanguage]: entry,
      },
    });

    try {
      await threadService.updateMessage(threadId, editingMessageId, {
        language: sourceLanguage,
        content_parts: entry.contentParts,
        reasoning_detail: entry.reasoningDetail as any,
      });
      await refetchThreadSnapshot(threadId);
      cancelEdit();
    } catch (error: any) {
      showAlert({ title: t('agent.edit'), message: error?.message ?? 'Failed to update message.' });
      await refetchThreadSnapshot(threadId).catch(() => {});
    } finally {
      setEditingSaving(false);
    }
  }, [
    cancelEdit,
    editingMessageId,
    editingSaving,
    editingText,
    sourceLanguage,
    t,
    threadId,
  ]);

  const translateMessage = useCallback(async (message: ThreadMessage, sourceContent: string) => {
    if (!threadId || !secondaryLanguage) return;
    if (message.role !== 'user' && message.role !== 'assistant') return;
    const text = sourceContent.trim();
    if (!text) return;

    let alreadyTranslating = false;
    setTranslatingByMessageId((prev) => {
      if (prev[message.id]) {
        alreadyTranslating = true;
        return prev;
      }
      return {
        ...prev,
        [message.id]: {
          sourceMessageId: message.id,
          targetLanguage: secondaryLanguage,
          hadTargetLanguageAtStart: Boolean(message.data[secondaryLanguage]),
        },
      };
    });
    if (alreadyTranslating) return;

    try {
      const result = await runMessageTranslation({
        projectId,
        sourceThreadId: threadId,
        sourceMessageId: message.id,
        sourceRole: message.role,
        sourceLanguage,
        targetLanguage: secondaryLanguage,
        sourceContent: text,
      });
      setTranslatingByMessageId((prev) => {
        const existing = prev[message.id];
        if (!existing || existing.targetLanguage !== secondaryLanguage) return prev;
        return {
          ...prev,
          [message.id]: {
            ...existing,
            journeyId: result.journeyId,
            journeyThreadId: result.journeyThreadId,
          },
        };
      });
    } catch (error: any) {
      showTranslationErrorToast(buildTranslationFailedMessage(error?.message));
      setTranslatingByMessageId((prev) => {
        if (!prev[message.id]) return prev;
        const next = { ...prev };
        delete next[message.id];
        return next;
      });
    }
  }, [
    buildTranslationFailedMessage,
    projectId,
    secondaryLanguage,
    showTranslationErrorToast,
    sourceLanguage,
    threadId,
  ]);

  const deleteMessage = useCallback(async (message: ThreadMessage, linkedToolCallCount: number = 0) => {
    if (!threadId) {
      showAlert({ title: 'Delete Failed', message: 'Could not find the thread.' });
      return;
    }

    const isAssistantResponse = message.role === 'assistant';
    const confirmed = await confirm({
      title: isAssistantResponse ? 'Delete Response' : 'Delete Message',
      message: isAssistantResponse
        ? (
            linkedToolCallCount > 0
              ? `Delete this response and its ${linkedToolCallCount} linked operation${linkedToolCallCount === 1 ? '' : 's'}?`
              : 'Are you sure you want to delete this response?'
          )
        : 'Are you sure you want to delete this message?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    const deletePauseContext = getThreadDeletePauseContext(threadId);
    const linkedToolCalls = Object.values(getMergedThreadView(threadId).toolCallsById)
      .filter((toolCall): toolCall is ThreadToolCall => Boolean(toolCall))
      .filter((toolCall) => toolCall.threadId === threadId && (
        toolCall.assistantMessageId === message.id
        || toolCall.messageId === message.id
      ));

    for (const toolCall of linkedToolCalls) {
      if (toolCall.messageId) removeSnapshotMessage(threadId, toolCall.messageId);
      removeSnapshotToolCall(threadId, toolCall.id);
    }
    removeSnapshotMessage(threadId, message.id);
    useThreadStreamStore.getState().removeOverlayMessage(threadId, message.id);
    applyOptimisticDeletePause(threadId, deletePauseContext);

    if (!isUuid(message.id)) return;

    try {
      await threadService.deleteMessage(threadId, message.id);
      await refetchThreadSnapshot(threadId);
    } catch (error) {
      console.error('Failed to delete message:', error);
      await refetchThreadSnapshot(threadId).catch(() => {});
    }
  }, [threadId]);

  const editModal = editingMessageId
    ? React.createElement(
        BaseModal,
        {
          isOpen: true,
          onClose: cancelEdit,
          title: t('agent.edit'),
          size: 'medium',
          zIndexLayer: 1,
          footer: React.createElement(
            React.Fragment,
            null,
            React.createElement(TextButton, {
              variant: 'secondary',
              onClick: cancelEdit,
              disabled: editingSaving,
              children: t('agent.cancel'),
            }),
            React.createElement(TextButton, {
              variant: 'primary',
              onClick: () => void saveEdit(),
              disabled: editingSaving || !editingText.trim(),
              loading: editingSaving,
              children: t('agent.save'),
            }),
          ),
          children: React.createElement(
            'div',
            { className: 'thread-message-edit' },
            React.createElement('textarea', {
              value: editingText,
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setEditingText(event.target.value),
              autoFocus: true,
            }),
          ),
        },
      )
    : null;

  return {
    rows,
    editingMessageId,
    translatingByMessageId,
    startEdit,
    translateMessage,
    deleteMessage,
    editModal,
    toToolCallMetadata,
  };
}

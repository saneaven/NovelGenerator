import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { ToolCallMetadata } from '../../types/chat';
import type { ToolCallDecisionMap } from '../../toolCall/types';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { threadService } from '../../api/threadService';
import { useThreadStore } from '../../store/threadStore';
import type { ThreadMessage, ThreadToolCall } from '../../types/thread';
import { resolveRunMessageDisplay } from '../../types/thread';
import { FunctionCallsThread } from '../../toolCall/ui';
import ThinkingDisplay from '../common/ThinkingDisplay';
import { IconButton } from '../IconButton';
import { Trash } from '../icons';
import { MarkdownRenderer } from '../MarkdownRenderer/MarkdownRenderer';
import { confirm } from '../../store/dialogStore';
import { decideToolCallsBatch } from '../../runtime/threadCommands';

function formatRole(role: string, t: (key: string) => string): string {
  if (role === 'user') return t('subAgent.parentAgent');
  if (role === 'assistant') return t('agent.ai');
  return role;
}

function formatTime(input?: Date | string): string {
  if (!input) return '';
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function hasPendingStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'streaming' || status === 'validating' || status === 'processing';
}

function collapseContent(parts: Array<{ type: 'content'; text: string }>): string {
  return parts
    .filter((part) => part.type === 'content')
    .map((part) => part.text)
    .join('');
}

function toToolCallMetadata(toolCall: ThreadToolCall): ToolCallMetadata {
  return {
    id: toolCall.id,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    status: toolCall.status as any,
    reason: toolCall.reason ?? undefined,
    result: toolCall.result as any,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

export interface SubAgentPeekTimelineProps {
  childThreadId: string;
  projectId: string;
}

export const SubAgentPeekTimeline: React.FC<SubAgentPeekTimelineProps> = ({
  childThreadId,
  projectId,
}) => {
  const { t } = useTranslation();
  const [isApplying, setIsApplying] = useState(false);
  const hydratedThreadIdsRef = useRef<Set<string>>(new Set());

  const { thread, threadMessages, toolCallsById, toolCallIdsByAssistantMessageId } = useThreadStore(
    useShallow((state) => ({
      thread: state.threadsById[childThreadId],
      threadMessages: state.messagesByThreadId[childThreadId],
      toolCallsById: state.toolCallsById,
      toolCallIdsByAssistantMessageId: state.toolCallIdsByAssistantMessageId,
    })),
  );

  const threadStatus = thread?.status ?? 'done';

  useEffect(() => {
    hydratedThreadIdsRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    if (!childThreadId) return;

    const store = useThreadStore.getState();
    const existingMessages = store.getMessages(childThreadId);
    if (hydratedThreadIdsRef.current.has(childThreadId) || existingMessages.length > 0) {
      hydratedThreadIdsRef.current.add(childThreadId);
      return;
    }

    let cancelled = false;
    void threadService
      .listMessages(childThreadId)
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
        hydratedThreadIdsRef.current.add(childThreadId);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Failed to hydrate sub-agent thread messages', { childThreadId, error });
      });

    return () => {
      cancelled = true;
    };
  }, [childThreadId]);

  const messages = useMemo(() => {
    if (!threadMessages) return [];
    return [...threadMessages]
      .filter((msg) => msg.role === 'assistant' && !msg.isStreaming)
      .sort((a, b) => {
        const aSit = a.seqInThread ?? Number.MAX_SAFE_INTEGER;
        const bSit = b.seqInThread ?? Number.MAX_SAFE_INTEGER;
        if (aSit !== bSit) return aSit - bSit;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }, [threadMessages]);

  const streamingMessage = useMemo(() => {
    if (!threadMessages) return null;
    return threadMessages.find((m) => m.role === 'assistant' && m.isStreaming) ?? null;
  }, [threadMessages]);

  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') return String(messages[i].id);
    }
    return null;
  }, [messages]);

  const getMessageText = useCallback((message: ThreadMessage): string => {
    const display = message.isStreaming
      ? { contentParts: message.streamingData?.contentParts ?? [] }
      : resolveRunMessageDisplay(message, 'English');
    return collapseContent(display.contentParts as Array<{ type: 'content'; text: string }>).trim();
  }, []);

  const getMessageReasoningDetail = useCallback((message: ThreadMessage) => {
    if (message.isStreaming) return message.streamingData?.reasoningDetail;
    return resolveRunMessageDisplay(message, 'English').reasoningDetail;
  }, []);

  const handleConfirm = useCallback(async (_messageId: string, decisions: ToolCallDecisionMap) => {
    setIsApplying(true);
    try {
      const accepts = Object.entries(decisions)
        .filter(([, d]) => d === 'accept')
        .map(([id]) => id);
      const rejects = Object.entries(decisions)
        .filter(([, d]) => d === 'reject')
        .map(([id]) => id);
      await decideToolCallsBatch({
        threadId: childThreadId,
        decisions: [
          ...accepts.map((id) => ({ toolCallId: id, decision: 'accept' as const })),
          ...rejects.map((id) => ({ toolCallId: id, decision: 'reject' as const })),
        ],
      });
    } finally {
      setIsApplying(false);
    }
  }, [childThreadId]);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    const confirmed = await confirm({
      title: 'Delete Message',
      message: 'Are you sure you want to delete this message?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    void threadService.deleteMessage(childThreadId, messageId).then(() => {
      useThreadStore.getState().removeMessage(childThreadId, messageId);
    });
  }, [childThreadId]);

  const streamingText = useMemo(() => {
    if (!streamingMessage?.streamingData?.contentParts) return '';
    return collapseContent(streamingMessage.streamingData.contentParts).trim();
  }, [streamingMessage]);

  return (
    <div className="sub-agent-peek-timeline">
      {threadStatus === 'error' && (
        <div className="sub-agent-peek-alert sub-agent-peek-alert--error">
          {thread?.lastError || 'An error occurred during sub-agent execution.'}
        </div>
      )}

      {messages.map((message, index) => {
        const text = getMessageText(message);
        const reasoningDetail = getMessageReasoningDetail(message);
        const tcIds = toolCallIdsByAssistantMessageId[message.id] ?? [];
        const toolCalls = tcIds
          .map((id) => toolCallsById[id])
          .filter((tc): tc is ThreadToolCall => Boolean(tc))
          .map(toToolCallMetadata);
        const isLatestAssistant = message.role === 'assistant' && String(message.id) === lastAssistantMessageId;
        const waitingDecision = isLatestAssistant && threadStatus === 'waiting';
        const cards = toolCalls.length > 0 ? buildEditCardsFromToolCallMetadata(toolCalls) : [];
        const hasPendingCards = cards.some((card) => hasPendingStatus(String(card.toolCall.status)));
        const showApplyingBanner = isApplying && isLatestAssistant && hasPendingCards;
        const previousMessage = index > 0 ? messages[index - 1] : null;
        const isSameRoleAsPrevious = previousMessage?.role === message.role;

        return (
          <div
            key={`${childThreadId}:${message.id}`}
            className={`agent-message ${message.role === 'assistant' ? 'assistant' : 'user'}${isSameRoleAsPrevious ? ' same-role-as-previous' : ''}`}
          >
            <div className="message-wrapper">
              {!isSameRoleAsPrevious && (
              <div className="message-header">
                <span className="message-role">{formatRole(message.role, t)}</span>
                <span className="message-time">{formatTime(message.createdAt)}</span>
              </div>
              )}
              {message.role === 'assistant' && (
                <ThinkingDisplay
                  messageId={String(message.id)}
                  reasoningDetail={reasoningDetail}
                  isStreaming={message.isStreaming === true}
                />
              )}
              {text && <div className="message-content"><MarkdownRenderer>{text}</MarkdownRenderer></div>}

              {cards.length > 0 && (
                <div className="message-function-calls">
                  <FunctionCallsThread
                    threadId={`${childThreadId}:message:${message.id}`}
                    mode={waitingDecision && hasPendingCards ? 'pending' : 'confirmed'}
                    cards={cards}
                    onCommitDecisions={
                      waitingDecision && hasPendingCards
                        ? (decisions) => handleConfirm(String(message.id), decisions)
                        : undefined
                    }
                    projectId={projectId}
                    isApplyDisabled={isApplying}
                    applyDisabledReason={showApplyingBanner ? 'Applying changes...' : undefined}
                  />
                </div>
              )}
              <div className="message-actions">
                <IconButton
                  icon={<Trash size="sm" />}
                  onClick={() => handleDeleteMessage(String(message.id))}
                  title={t('agent.delete')}
                  variant="ghost"
                  size="xs"
                  className="icon-button--ghost-danger"
                />
              </div>
            </div>
          </div>
        );
      })}

      {streamingMessage && (
        <div className={`agent-message assistant${messages.length > 0 && messages[messages.length - 1].role === 'assistant' ? ' same-role-as-previous' : ''}`}>
          <div className="message-wrapper">
            {!(messages.length > 0 && messages[messages.length - 1].role === 'assistant') && (
            <div className="message-header">
              <span className="message-role">{t('agent.ai')}</span>
              <span className="message-time">{t('operationStatus.streaming')}</span>
            </div>
            )}
            <ThinkingDisplay
              messageId={`stream:${childThreadId}`}
              reasoningDetail={streamingMessage.streamingData?.reasoningDetail}
              isStreaming={true}
            />
            {streamingText && (
              <div className="message-content"><MarkdownRenderer>{streamingText}</MarkdownRenderer></div>
            )}
            <div className="typing-indicator inline">
              <div className="loading-track">
                <div className="loading-bar" />
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default SubAgentPeekTimeline;

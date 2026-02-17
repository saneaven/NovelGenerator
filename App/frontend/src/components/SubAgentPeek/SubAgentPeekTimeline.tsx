import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { ContentPart, ToolCallMetadata } from '../../types/chat';
import type { ToolCallDecisionMap } from '../../toolCall/types';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { collapseContentParts } from '../../agent/utils/contentParts';
import { useThreadStore } from '../../store/threadStore';
import type { ThreadMessage, ThreadToolCall } from '../../types/thread';
import { isBlockingThreadStatus, resolveRunMessageDisplay } from '../../types/thread';
import { FunctionCallsThread } from '../../toolCall/ui';
import ThinkingDisplay from '../common/ThinkingDisplay';
import { IconButton } from '../IconButton';
import { ChevronRight, Trash } from '../icons';
import { MarkdownRenderer } from '../MarkdownRenderer/MarkdownRenderer';
import { TextButton } from '../TextButton';
import { isUuid } from '../../utils/idUtils';

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
  return status === 'pending' || status === 'running';
}


function toContentParts(parts: Array<{ type: string; text: string }>): ContentPart[] {
  return parts.map((part) => ({
    type: part.type === 'thinking' ? 'thinking' : 'content',
    text: String(part.text ?? ''),
  }));
}

function toToolCallMetadata(toolCall: ThreadToolCall): ToolCallMetadata {
  return {
    id: toolCall.llmCallId,
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
  finalOutput?: string | null;
}

export const SubAgentPeekTimeline: React.FC<SubAgentPeekTimelineProps> = ({
  childThreadId,
  projectId,
  finalOutput,
}) => {
  const { t } = useTranslation();
  const [isApplying, setIsApplying] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<'pause' | 'retry' | 'cancel' | null>(null);
  const [resultExpanded, setResultExpanded] = useState(false);

  const { thread, threadMessages, toolCallsByMessageId } = useThreadStore(
    useShallow((state) => ({
      thread: state.threadsById[childThreadId],
      threadMessages: state.messagesByThreadId[childThreadId],
      toolCallsByMessageId: state.toolCallsByMessageId,
    })),
  );

  const threadStatus = thread?.status ?? 'idle';
  const isBlocking = isBlockingThreadStatus(threadStatus);

  const messages = useMemo(() => {
    if (!threadMessages) return [];
    return [...threadMessages]
      .filter((msg) => msg.role === 'assistant' && !msg.id.startsWith('delta:'))
      .sort((a, b) => {
        const aSit = a.seqInThread ?? Number.MAX_SAFE_INTEGER;
        const bSit = b.seqInThread ?? Number.MAX_SAFE_INTEGER;
        if (aSit !== bSit) return aSit - bSit;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }, [threadMessages]);

  const deltaMessage = useMemo(() => {
    if (!threadMessages) return null;
    return threadMessages.find((m) => m.id.startsWith('delta:')) ?? null;
  }, [threadMessages]);

  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') return String(messages[i].id);
    }
    return null;
  }, [messages]);

  const getMessageText = useCallback((message: ThreadMessage): string => {
    const display = resolveRunMessageDisplay(message, '_final', '_streaming');
    return collapseContentParts(display.contentParts as any).content.trim();
  }, []);

  const getMessageContentParts = useCallback((message: ThreadMessage): ContentPart[] => {
    const display = resolveRunMessageDisplay(message, '_final', '_streaming');
    return toContentParts(display.contentParts);
  }, []);

  // TODO: reimplement via new backend orchestration API
  const handleConfirm = useCallback(async (_messageId: string, _decisions: ToolCallDecisionMap) => {
    setIsApplying(true);
    try {
      throw new Error('Not implemented: threadOrchestrator.toolDecisions');
    } finally {
      setIsApplying(false);
    }
  }, []);

  const handlePause = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('pause');
    console.warn('Not implemented: threadOrchestrator.pause');
    setActionInFlight(null);
  }, [actionInFlight]);

  const handleRetry = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('retry');
    console.warn('Not implemented: threadOrchestrator.resume');
    setActionInFlight(null);
  }, [actionInFlight]);

  const handleCancel = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('cancel');
    console.warn('Not implemented: threadOrchestrator.cancel');
    setActionInFlight(null);
  }, [actionInFlight]);

  // TODO: reimplement message deletion via new backend API
  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!confirm('Are you sure you want to delete this message?')) return;
    useThreadStore.getState().removeMessage(childThreadId, messageId);
  }, [childThreadId]);

  const actionDisabled = isApplying || actionInFlight !== null;

  // Streaming content from delta message
  const streamingContentParts = useMemo<ContentPart[] | null>(() => {
    if (!deltaMessage) return null;
    const entry = deltaMessage.data._streaming;
    if (!entry?.contentParts) return null;
    return toContentParts(entry.contentParts);
  }, [deltaMessage]);

  const streamingText = useMemo(() => {
    if (!streamingContentParts) return '';
    return collapseContentParts(streamingContentParts as any).content.trim();
  }, [streamingContentParts]);

  return (
    <div className="sub-agent-peek-timeline">
      {threadStatus === 'error' && (
        <div className="sub-agent-peek-alert sub-agent-peek-alert--error">
          An error occurred during sub-agent execution.
        </div>
      )}

      {messages.map((message, index) => {
        const contentParts = getMessageContentParts(message);
        const text = getMessageText(message);
        const toolCalls = (toolCallsByMessageId[message.id] ?? [])
          .map(toToolCallMetadata);
        const isLatestAssistant = message.role === 'assistant' && String(message.id) === lastAssistantMessageId;
        const waitingDecision = isLatestAssistant && threadStatus === 'waiting_tools';
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
                  contentParts={contentParts}
                  isStreaming={false}
                />
              )}
              {text && <div className="message-content">{text}</div>}

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

      {deltaMessage && streamingContentParts && (
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
              contentParts={streamingContentParts}
              isStreaming={true}
            />
            {streamingText && (
              <div className="message-content">{streamingText}</div>
            )}
            <div className="typing-indicator inline">
              <div className="loading-track">
                <div className="loading-bar" />
              </div>
            </div>
          </div>
        </div>
      )}

      {finalOutput && (
        <div className="sub-agent-result-section">
          <button
            type="button"
            className="sub-agent-result-toggle"
            onClick={() => setResultExpanded((prev) => !prev)}
          >
            <span className={`sub-agent-result-chevron${resultExpanded ? ' expanded' : ''}`}>
              <ChevronRight size="sm" />
            </span>
            <span className="sub-agent-result-label">Sub Agent Result</span>
          </button>
          {resultExpanded && (
            <div className="sub-agent-result-content">
              <MarkdownRenderer>{finalOutput}</MarkdownRenderer>
            </div>
          )}
        </div>
      )}

      <div className="sub-agent-peek-actions">
        {isBlocking && (threadStatus === 'running' || threadStatus === 'waiting_tools') && (
          <TextButton
            size="sm"
            variant="secondary"
            onClick={handlePause}
            disabled={actionDisabled}
            loading={actionInFlight === 'pause'}
          >
            {t('subAgent.pause')}
          </TextButton>
        )}
        {isBlocking && (threadStatus === 'paused' || threadStatus === 'error') && (
          <>
            <TextButton
              size="sm"
              variant="primary"
              onClick={handleRetry}
              disabled={actionDisabled}
              loading={actionInFlight === 'retry'}
            >
              {t('common.retry')}
            </TextButton>
            <TextButton
              size="sm"
              variant="warning"
              onClick={handleCancel}
              disabled={actionDisabled}
              loading={actionInFlight === 'cancel'}
            >
              {t('common.cancel')}
            </TextButton>
          </>
        )}
      </div>
    </div>
  );
};

export default SubAgentPeekTimeline;

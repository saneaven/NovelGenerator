import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { TaskSessionState } from '../../llmTask/types';
import type { ChatMessage, ToolCallMetadata } from '../../llm/requestTypes';
import type { ToolCallDecisionMap } from '../../toolCall/types';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { collapseContentParts } from '../../agent/utils/contentParts';
import { runtimeOrchestrator, useRuntimeStore, type Run, type RunToolCall } from '../../runtime';
import { runService } from '../../api/runService';
import { FunctionCallsThread } from '../../toolCall/ui';
import ThinkingDisplay from '../common/ThinkingDisplay';
import { IconButton } from '../IconButton';
import { ChevronRight, Trash } from '../icons';
import { MarkdownRenderer } from '../MarkdownRenderer/MarkdownRenderer';
import { TextButton } from '../TextButton';

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

function messageText(message: ChatMessage): string {
  return collapseContentParts(message.contentParts ?? []).content.trim();
}

function hasPendingStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'running';
}

function toToolCallMetadata(toolCall: RunToolCall): ToolCallMetadata {
  return {
    id: toolCall.llmCallId,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    status: toolCall.status,
    reason: toolCall.reason,
    failureType: toolCall.failureType,
    result: toolCall.result as any,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

function toChatMessage(message: any): ChatMessage {
  return {
    id: message.id,
    seq: message.seq,
    role: message.role,
    contentParts: message.contentParts,
    timestamp: new Date(message.createdAt),
    thinking_details: message.thinkingDetails,
  } as ChatMessage;
}

export interface SubAgentPeekTimelineProps {
  threadId: string;
  runId: string;
  run: Run;
  activeSession?: TaskSessionState<any, any>;
}

export const SubAgentPeekTimeline: React.FC<SubAgentPeekTimelineProps> = ({
  threadId,
  runId,
  run,
  activeSession,
}) => {
  const { t } = useTranslation();
  const [isApplying, setIsApplying] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<'pause' | 'retry' | 'cancel' | null>(null);
  const [resultExpanded, setResultExpanded] = useState(false);

  const { runMessagesByRunId, runToolCallsByMessageId } = useRuntimeStore(
    useShallow((state) => ({
      runMessagesByRunId: state.runMessagesByRunId,
      runToolCallsByMessageId: state.runToolCallsByMessageId,
    })),
  );

  const messages = useMemo(() => {
    const history = runMessagesByRunId[runId] ?? [];
    return [...history]
      .filter((msg) => msg.role !== 'user')
      .sort((a, b) => a.seq - b.seq);
  }, [runMessagesByRunId, runId]);

  const lastAssistantMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') return String(messages[i].id);
    }
    return null;
  }, [messages]);

  const handleConfirm = useCallback(async (runMessageId: string, decisions: ToolCallDecisionMap) => {
    setIsApplying(true);
    try {
      await runtimeOrchestrator.applyRunToolCallDecisions({
        runId,
        runMessageId,
        decisions,
      });
    } finally {
      setIsApplying(false);
    }
  }, [runId]);

  const handlePause = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('pause');
    void runtimeOrchestrator.pauseRun(runId).finally(() => {
      setActionInFlight(null);
    });
  }, [actionInFlight, runId]);

  const handleRetry = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('retry');
    void runtimeOrchestrator.retryRun(runId).finally(() => {
      setActionInFlight(null);
    });
  }, [actionInFlight, runId]);

  const handleCancel = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('cancel');
    void runtimeOrchestrator.cancelRun(runId).finally(() => {
      setActionInFlight(null);
    });
  }, [actionInFlight, runId]);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!confirm('Are you sure you want to delete this message?')) return;
    void (async () => {
      try {
        await runService.deleteRunMessage(run.projectId, run.agentId, runId, messageId);
      } catch (error) {
        console.error('Failed to delete sub-agent message:', error);
        return;
      }
      useRuntimeStore.getState().removeRunMessage(runId, messageId);
    })();
  }, [run.projectId, run.agentId, runId]);

  const streamingText = useMemo(() => {
    if (!activeSession || activeSession.status !== 'running') return '';
    return collapseContentParts(activeSession.contentParts ?? []).content.trim();
  }, [activeSession]);
  const actionDisabled = isApplying || actionInFlight !== null;

  return (
    <div className="sub-agent-peek-timeline">
      {run.error && (run.status === 'error' || run.status === 'paused') && (
        <div className="sub-agent-peek-alert sub-agent-peek-alert--error">{run.error}</div>
      )}

      {messages.map((message, index) => {
        const chatMessage = toChatMessage(message);
        const text = messageText(chatMessage);
        const toolCalls = (runToolCallsByMessageId[message.id] ?? [])
          .filter((tc) => tc.toolName !== 'return_sub_agent_result')
          .map(toToolCallMetadata);
        const isLatestAssistant = message.role === 'assistant' && String(message.id) === lastAssistantMessageId;
        const waitingDecision = isLatestAssistant && run.status === 'waiting';
        const cards = toolCalls.length > 0 ? buildEditCardsFromToolCallMetadata(toolCalls) : [];
        const hasPendingCards = cards.some((card) => hasPendingStatus(String(card.toolCall.status)));
        const showApplyingBanner = isApplying && isLatestAssistant && hasPendingCards;
        const previousMessage = index > 0 ? messages[index - 1] : null;
        const isSameRoleAsPrevious = previousMessage?.role === message.role;

        return (
          <div
            key={`${run.id}:${message.id}`}
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
                  contentParts={chatMessage.contentParts}
                  isStreaming={false}
                />
              )}
              {text && <div className="message-content">{text}</div>}

              {cards.length > 0 && (
                <div className="message-function-calls">
                  <FunctionCallsThread
                    threadId={`${threadId}:message:${run.id}:${message.id}`}
                    mode={waitingDecision && hasPendingCards ? 'pending' : 'confirmed'}
                    cards={cards}
                    onCommitDecisions={
                      waitingDecision && hasPendingCards
                        ? (decisions) => handleConfirm(String(message.id), decisions)
                        : undefined
                    }
                    projectId={run.projectId}
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

      {activeSession?.status === 'running' && (
        <div className={`agent-message assistant${messages.length > 0 && messages[messages.length - 1].role === 'assistant' ? ' same-role-as-previous' : ''}`}>
          <div className="message-wrapper">
            {!(messages.length > 0 && messages[messages.length - 1].role === 'assistant') && (
            <div className="message-header">
              <span className="message-role">{t('agent.ai')}</span>
              <span className="message-time">{t('operationStatus.streaming')}</span>
            </div>
            )}
            <ThinkingDisplay
              messageId={`stream:${run.id}`}
              contentParts={activeSession.contentParts}
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
            {Array.isArray(activeSession.toolCallProgress) && activeSession.toolCallProgress.length > 0 && (
              <div className="message-function-calls">
                <FunctionCallsThread
                  threadId={`${threadId}:stream:${run.id}`}
                  mode="streaming"
                  streamingProgress={activeSession.toolCallProgress}
                  projectId={run.projectId}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {run.finalOutput && (
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
              <MarkdownRenderer>{run.finalOutput}</MarkdownRenderer>
            </div>
          )}
        </div>
      )}

      <div className="sub-agent-peek-actions">
        {(run.status === 'running' || run.status === 'waiting') && (
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
        {(run.status === 'paused' || run.status === 'error') && (
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

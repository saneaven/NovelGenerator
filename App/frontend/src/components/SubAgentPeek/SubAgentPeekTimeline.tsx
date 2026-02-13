import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskSessionState } from '../../llmTask/types';
import type { ChatMessage, ToolCallMetadata } from '../../llm/requestTypes';
import type { ToolCallDecisionMap } from '../../toolCall/types';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { collapseContentParts } from '../../agent/utils/contentParts';
import { SubAgentManager } from '../../subAgent/runtime/SubAgentManager';
import type { SubAgentRun } from '../../store/subAgentRuntimeStore';
import { FunctionCallsThread } from '../../toolCall/ui';
import ThinkingDisplay from '../common/ThinkingDisplay';
import { TextButton } from '../TextButton';

function formatRole(role: string, t: (key: string) => string): string {
  if (role === 'user') return t('subAgent.parentAgent');
  if (role === 'assistant') return t('agent.ai');
  return role;
}

function formatTime(input?: Date): string {
  if (!input) return '';
  if (Number.isNaN(input.getTime())) return '';
  return input.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function messageText(message: ChatMessage): string {
  return collapseContentParts(message.contentParts ?? []).content.trim();
}

function hasPendingStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'validating' || status === 'processing' || status === 'running';
}

export interface SubAgentPeekTimelineProps {
  threadId: string;
  runKey: string;
  run: SubAgentRun;
  activeSession?: TaskSessionState<any, any>;
}

export const SubAgentPeekTimeline: React.FC<SubAgentPeekTimelineProps> = ({
  threadId,
  runKey,
  run,
  activeSession,
}) => {
  const { t } = useTranslation();
  const [isApplying, setIsApplying] = useState(false);
  const [actionInFlight, setActionInFlight] = useState<'pause' | 'retry' | 'cancel' | null>(null);

  const lastAssistantIndex = useMemo(() => {
    for (let i = run.history.length - 1; i >= 0; i--) {
      if (run.history[i]?.role === 'assistant') return i;
    }
    return -1;
  }, [run.history]);

  const handleConfirm = useCallback(async (decisions: ToolCallDecisionMap) => {
    setIsApplying(true);
    try {
      await SubAgentManager.applyAndContinue(runKey, decisions);
    } finally {
      setIsApplying(false);
    }
  }, [runKey]);

  const handlePause = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('pause');
    void SubAgentManager.pause(runKey).finally(() => {
      setActionInFlight(null);
    });
  }, [actionInFlight, runKey]);

  const handleRetry = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('retry');
    void SubAgentManager.retry(runKey).finally(() => {
      setActionInFlight(null);
    });
  }, [runKey]);

  const handleCancel = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('cancel');
    void SubAgentManager.cancel(runKey).finally(() => {
      setActionInFlight(null);
    });
  }, [actionInFlight, runKey]);

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

      {run.history.map((message, index) => {
        const text = messageText(message);
        const toolCalls = (message.toolCalls ?? []) as ToolCallMetadata[];
        const isLatestAssistant = message.role === 'assistant' && index === lastAssistantIndex;
        const waitingDecision = isLatestAssistant && run.status === 'waiting';
        const cards = toolCalls.length > 0 ? buildEditCardsFromToolCallMetadata(toolCalls) : [];
        const hasPendingCards = cards.some((card) => hasPendingStatus(card.toolCall.status));
        const showApplyingBanner = isApplying && isLatestAssistant && hasPendingCards;

        return (
          <div
            key={`${run.id}:${message.id}`}
            className={`agent-message ${message.role === 'assistant' ? 'assistant' : 'user'}`}
          >
            <div className="message-wrapper">
              <div className="message-header">
                <span className="message-role">{formatRole(message.role, t)}</span>
                <span className="message-time">{formatTime(message.timestamp as Date)}</span>
              </div>
              {message.role === 'assistant' && (
                <ThinkingDisplay
                  messageId={String(message.id)}
                  contentParts={message.contentParts}
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
                    onCommitDecisions={waitingDecision && hasPendingCards ? handleConfirm : undefined}
                    projectId={run.projectId}
                    isApplyDisabled={isApplying}
                    applyDisabledReason={showApplyingBanner ? 'Applying changes...' : undefined}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}

      {activeSession?.status === 'running' && (
        <div className="agent-message assistant">
          <div className="message-wrapper">
            <div className="message-header">
              <span className="message-role">{t('agent.ai')}</span>
              <span className="message-time">{t('operationStatus.streaming')}</span>
            </div>
            <ThinkingDisplay
              messageId={`stream:${run.id}`}
              contentParts={activeSession.contentParts}
              isStreaming={true}
            />
            {streamingText && (
              <div className="message-content">{streamingText}</div>
            )}
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
        <div className="agent-message assistant">
          <div className="message-wrapper">
            <div className="message-header">
              <span className="message-role">{t('agent.ai')}</span>
              <span className="message-time">{t('operationStatus.applied')}</span>
            </div>
            <div className="message-content">{run.finalOutput}</div>
          </div>
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

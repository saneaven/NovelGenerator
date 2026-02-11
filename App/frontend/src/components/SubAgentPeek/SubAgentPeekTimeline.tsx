import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskSessionState } from '../../llmTask/types';
import type { ChatMessage, ToolCallMetadata } from '../../llm/requestTypes';
import type { ToolCallDecisionMap } from '../../toolCall/types';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { collapseContentParts } from '../../agent/utils/contentParts';
import { SubAgentManager } from '../../subAgent/runtime/SubAgentManager';
import type { SubAgentInvocation } from '../../store/subAgentRuntimeStore';
import { FunctionCallsThread } from '../../toolCall/ui';
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
  return status === 'pending' || status === 'validating' || status === 'running';
}

export interface SubAgentPeekTimelineProps {
  threadId: string;
  invocationKey: string;
  invocation: SubAgentInvocation;
  activeSession?: TaskSessionState<any, any>;
}

export const SubAgentPeekTimeline: React.FC<SubAgentPeekTimelineProps> = ({
  threadId,
  invocationKey,
  invocation,
  activeSession,
}) => {
  const { t } = useTranslation();
  const [isApplying, setIsApplying] = useState(false);

  const lastAssistantIndex = useMemo(() => {
    for (let i = invocation.history.length - 1; i >= 0; i--) {
      if (invocation.history[i]?.role === 'assistant') return i;
    }
    return -1;
  }, [invocation.history]);

  const handleConfirm = useCallback(async (decisions: ToolCallDecisionMap) => {
    setIsApplying(true);
    try {
      await SubAgentManager.applyAndContinue({
        invocationKey,
        decisions,
        autoContinue: true,
      });
    } finally {
      setIsApplying(false);
    }
  }, [invocationKey]);

  const handleConfirmAndPause = useCallback(async (decisions: ToolCallDecisionMap) => {
    setIsApplying(true);
    try {
      await SubAgentManager.applyAndContinue({
        invocationKey,
        decisions,
        autoContinue: false,
      });
    } finally {
      setIsApplying(false);
    }
  }, [invocationKey]);

  const handleResume = useCallback(() => {
    void SubAgentManager.resume(invocationKey);
  }, [invocationKey]);

  const handleStop = useCallback(() => {
    void SubAgentManager.cancel(invocationKey);
  }, [invocationKey]);

  const streamingText = useMemo(() => {
    if (!activeSession || activeSession.status !== 'running') return '';
    return collapseContentParts(activeSession.contentParts ?? []).content.trim();
  }, [activeSession]);

  return (
    <div className="sub-agent-peek-timeline">
      {invocation.error && invocation.status === 'error' && (
        <div className="sub-agent-peek-alert sub-agent-peek-alert--error">{invocation.error}</div>
      )}

      {invocation.history.map((message, index) => {
        const text = messageText(message);
        const toolCalls = (message.toolCalls ?? []) as ToolCallMetadata[];
        const isLatestAssistant = message.role === 'assistant' && index === lastAssistantIndex;
        const awaitingDecision = isLatestAssistant && invocation.status === 'awaiting_confirmation';
        const cards = toolCalls.length > 0 ? buildEditCardsFromToolCallMetadata(toolCalls) : [];
        const hasPendingCards = cards.some((card) => hasPendingStatus(card.toolCall.status));
        const showApplyingBanner = isApplying && isLatestAssistant && hasPendingCards;

        return (
          <div
            key={`${invocation.id}:${message.id}`}
            className={`agent-message ${message.role === 'assistant' ? 'assistant' : 'user'}`}
          >
            <div className="message-wrapper">
              <div className="message-header">
                <span className="message-role">{formatRole(message.role, t)}</span>
                <span className="message-time">{formatTime(message.timestamp as Date)}</span>
              </div>
              {text && <div className="message-content">{text}</div>}

              {cards.length > 0 && (
                <div className="message-function-calls">
                  <FunctionCallsThread
                    threadId={`${threadId}:message:${invocation.id}:${message.id}`}
                    mode={awaitingDecision && hasPendingCards ? 'pending' : 'confirmed'}
                    cards={cards}
                    onCommitDecisions={awaitingDecision && hasPendingCards ? handleConfirm : undefined}
                    onCommitDecisionsAndPause={awaitingDecision && hasPendingCards ? handleConfirmAndPause : undefined}
                    projectId={invocation.projectId}
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
            {streamingText && (
              <div className="message-content">{streamingText}</div>
            )}
            {Array.isArray(activeSession.toolCallProgress) && activeSession.toolCallProgress.length > 0 && (
              <div className="message-function-calls">
                <FunctionCallsThread
                  threadId={`${threadId}:stream:${invocation.id}`}
                  mode="streaming"
                  streamingProgress={activeSession.toolCallProgress}
                  projectId={invocation.projectId}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {invocation.finalOutput && (
        <div className="agent-message assistant">
          <div className="message-wrapper">
            <div className="message-header">
              <span className="message-role">{t('agent.ai')}</span>
              <span className="message-time">{t('operationStatus.applied')}</span>
            </div>
            <div className="message-content">{invocation.finalOutput}</div>
          </div>
        </div>
      )}

      <div className="sub-agent-peek-actions">
        {invocation.status === 'paused' && (
          <TextButton size="sm" variant="secondary" onClick={handleResume}>
            Continue
          </TextButton>
        )}
        {(invocation.status === 'running' || invocation.status === 'awaiting_confirmation' || invocation.status === 'paused') && (
          <TextButton size="sm" variant="danger" onClick={handleStop}>
            {t('agent.stop')}
          </TextButton>
        )}
      </div>
    </div>
  );
};

export default SubAgentPeekTimeline;

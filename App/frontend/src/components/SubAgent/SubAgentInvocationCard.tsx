import React, { useMemo, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import { useSubAgentRuntimeStore } from '../../store/subAgentRuntimeStore';
import { SubAgentManager } from '../../subAgent/runtime/SubAgentManager';
import type { ChatMessage, ToolCallMetadata } from '../../llm/requestTypes';
import { ToolCallCard } from '../toolCall';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { TextButton } from '../TextButton';
import './SubAgentInvocationCard.css';

function contentText(parts: Array<{ type: string; text: string }>): string {
  return parts
    .filter((p) => p.type === 'content')
    .map((p) => p.text)
    .join('')
    .trim();
}

function formatRole(role: string, t: (key: string) => string): string {
  if (role === 'user') return t('subAgent.parentAgent');
  if (role === 'assistant') return t('agent.ai');
  return role;
}

function pillVariantForStatus(status: string): string {
  switch (status) {
    case 'awaiting_confirmation':
      return 'pending';
    case 'running':
      return 'running';
    case 'paused':
      return 'pending';
    case 'completed':
      return 'accepted';
    case 'cancelled':
      return 'rejected';
    case 'error':
      return 'failed';
    default:
      return 'pending';
  }
}

export interface SubAgentInvocationCardProps {
  parentToolCallId: string;
  depth?: number;
}

export const SubAgentInvocationCard: React.FC<SubAgentInvocationCardProps> = ({ parentToolCallId, depth = 0 }) => {
  const { t } = useTranslation();
  const invocation = useSubAgentRuntimeStore((s) => s.invocationsByToolCallId[parentToolCallId]);
  const activeSessionId = invocation?.activeSessionId ?? null;
  const activeSession = useLLMSessionStore((s) => (activeSessionId ? s.sessions[activeSessionId] : undefined));

  const [expanded, setExpanded] = useState(true);
  const [isApplying, setIsApplying] = useState(false);

  const toggleExpanded = useCallback(() => setExpanded((v) => !v), []);

  const lastAssistantIndex = useMemo(() => {
    if (!invocation) return -1;
    for (let i = invocation.history.length - 1; i >= 0; i--) {
      if (invocation.history[i].role === 'assistant') return i;
    }
    return -1;
  }, [invocation]);

  const handleCancel = useCallback(() => {
    SubAgentManager.cancel(parentToolCallId);
  }, [parentToolCallId]);

  const handleResume = useCallback(async () => {
    await SubAgentManager.resume(parentToolCallId);
  }, [parentToolCallId]);

  const handleConfirm = useCallback(async (selections: Record<string, boolean>) => {
    setIsApplying(true);
    try {
      await SubAgentManager.applyAndContinue({ parentToolCallId, selections, autoContinue: true });
    } finally {
      setIsApplying(false);
    }
  }, [parentToolCallId]);

  const handleConfirmAndPause = useCallback(async (selections: Record<string, boolean>) => {
    setIsApplying(true);
    try {
      await SubAgentManager.applyAndContinue({ parentToolCallId, selections, autoContinue: false });
    } finally {
      setIsApplying(false);
    }
  }, [parentToolCallId]);

  if (!invocation) return null;

  const statusPill = pillVariantForStatus(invocation.status);
  const containerStyle = depth > 0 ? { marginLeft: depth * 16 } : undefined;

  return (
    <div className="sub-agent-card" style={containerStyle}>
      <button type="button" className="sub-agent-card__header" onClick={toggleExpanded} aria-expanded={expanded}>
        <div className="sub-agent-card__header-title">
          <div className="sub-agent-card__name">{invocation.displayName}</div>
          <div className="sub-agent-card__id">{invocation.subAgentId}</div>
        </div>
        <span className={`tool-call-pill tool-call-pill--${statusPill}`}>{invocation.status}</span>
      </button>

      {expanded && (
        <div className="sub-agent-card__body">
          {invocation.error && invocation.status === 'error' && (
            <div className="sub-agent-error">{invocation.error}</div>
          )}

          {/* Streaming preview for the current turn */}
          {activeSession?.status === 'running' && (
            <div className="sub-agent-message">
              <div className="sub-agent-message__meta">
                <span className="sub-agent-message__role">{t('agent.ai')}</span>
                <span>{t('operationStatus.streaming')}</span>
              </div>
              <div className="sub-agent-message__content">
                {contentText(activeSession.contentParts as any)}
              </div>
              {activeSession.toolCallProgress?.length > 0 && (
                <div style={{ marginTop: 'var(--spacing-md)' }}>
                  <ToolCallCard mode="streaming" streamingProgress={activeSession.toolCallProgress} projectId={invocation.projectId} />
                </div>
              )}
            </div>
          )}

          <div className="sub-agent-messages">
            {invocation.history.map((msg: ChatMessage, idx: number) => {
              const text = contentText(msg.contentParts as any);
              const toolCalls = (msg as any).toolCalls as ToolCallMetadata[] | undefined;
              const isLatestAssistant = idx === lastAssistantIndex && msg.role === 'assistant';
              const isAwaiting = isLatestAssistant && invocation.status === 'awaiting_confirmation';

              const cards = toolCalls ? buildEditCardsFromToolCallMetadata(toolCalls) : [];
              const sessionCards = isAwaiting ? activeSession?.editCards : undefined;
              const cardsToRender = (isAwaiting && sessionCards && sessionCards.length > 0) ? sessionCards : cards;

              return (
                <div key={msg.id} className="sub-agent-message">
                  <div className="sub-agent-message__meta">
                    <span className="sub-agent-message__role">{formatRole(msg.role, t)}</span>
                    <span>{new Date(msg.timestamp as any).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {text && <div className="sub-agent-message__content">{text}</div>}

                  {toolCalls && toolCalls.length > 0 && (
                    <div style={{ marginTop: 'var(--spacing-md)' }}>
                      <ToolCallCard
                        mode={isAwaiting ? 'pending' : 'confirmed'}
                        cards={cardsToRender as any}
                        onConfirm={isAwaiting ? handleConfirm : undefined}
                        onConfirmAndPause={isAwaiting ? handleConfirmAndPause : undefined}
                        projectId={invocation.projectId}
                        isApplyDisabled={isApplying}
                        applyDisabledReason={isApplying ? 'Applying changes...' : undefined}
                      />

                      {/* Nested Sub Agent sessions (recursion) */}
                      {toolCalls
                        .filter((tc) => typeof tc.tool_name === 'string' && tc.tool_name.startsWith('call_'))
                        .map((tc) => (
                          <SubAgentInvocationCard
                            key={tc.id}
                            parentToolCallId={tc.id}
                            depth={depth + 1}
                          />
                        ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {invocation.finalOutput && (
            <div className="sub-agent-final">{invocation.finalOutput}</div>
          )}

          <div className="sub-agent-card__actions">
            {invocation.status === 'paused' && (
              <TextButton onClick={handleResume}>Continue</TextButton>
            )}
            {(invocation.status === 'running' || invocation.status === 'awaiting_confirmation' || invocation.status === 'paused') && (
              <TextButton onClick={handleCancel} variant="danger">{t('agent.stop')}</TextButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SubAgentInvocationCard;

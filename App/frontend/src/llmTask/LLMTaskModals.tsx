/**
 * Agent Detail Modal
 * Renders modal for agent session details from llmSessionStore
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { BaseModal } from '../components/BaseModal';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { useAgentStore } from '../store/agentStore';
import { useAgentUIStore } from '../store/agentUIStore';
import { useSettingsStore } from '../store/settingsStore';
import ThinkingDisplay from '../components/common/ThinkingDisplay';
import NotificationProgressBar from '../components/Notification/NotificationProgressBar';
import { Close } from '../components/icons';
import { TextButton } from '../components/TextButton';
import { IconButton } from '../components/IconButton';
import { FunctionCallsThread } from '../toolCall/ui';
import { buildEditCardsFromToolCallMetadata } from '../toolCall';
import {
  AgentExecutor,
  type AgentExecutorInput,
  type AgentExecutorResult,
  type AgentTranslationInput,
  executeAgentToolCalls,
} from '../agent';
import type { InvocationCaller } from '../types/agentRuntime';
import { CRUD_OPTIONS } from '../toolCall/apply/types';
import type { ToolCallDecisionMap, ToolCallStatus } from '../toolCall/types';
import './LLMTaskModals.css';

function isPendingStatus(status: string | undefined): boolean {
  const normalized = (status ?? 'pending') as ToolCallStatus;
  return normalized === 'pending' || normalized === 'validating' || normalized === 'running';
}

export const LLMTaskModals: React.FC = () => {
  const detailSessionId = useAgentUIStore((state) => state.detailSessionId);
  const closeDetailModal = useAgentUIStore((state) => state.closeDetailModal);

  const session = useLLMSessionStore((state) =>
    detailSessionId ? state.sessions[detailSessionId] : null
  );
  const cancelSession = useLLMSessionStore((state) => state.cancelSession);
  const mainLanguage = useSettingsStore((state) => state.getSettings().mainLanguage);

  const [outputExpanded, setOutputExpanded] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    userScrolledUpRef.current = false;
    setIsApplying(false);
  }, [detailSessionId]);

  const handleBodyScroll = useCallback(() => {
    const element = bodyRef.current;
    if (!element) return;
    const threshold = 50;
    const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
    userScrolledUpRef.current = !isAtBottom;
  }, []);

  const lastContentPart = session?.contentParts?.[session.contentParts.length - 1]?.text ?? '';
  const toolCallProgressLength = session?.toolCallProgress?.length ?? 0;

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const element = bodyRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [lastContentPart, toolCallProgressLength, session?.status]);

  const agentContext = useMemo(() => {
    if (!session || session.kind !== 'agent') return null;
    const input = session.input as AgentExecutorInput;
    const result = session.result as AgentExecutorResult | undefined;
    const assistantMessageId = result?.assistantMessageId;
    if (!assistantMessageId) return null;

    return {
      projectId: input.projectId,
      agentId: input.agentId,
      assistantMessageId,
      runMode: input.runMode,
    };
  }, [session?.id, session?.kind, session?.input, session?.result]);

  const agentToolCallsSelector = useMemo(
    () => (state: ReturnType<typeof useAgentStore.getState>) => {
      if (!agentContext) return undefined;
      const agent = state.getAgent(agentContext.projectId, agentContext.agentId);
      return agent?.messages.find((message) => message.id === agentContext.assistantMessageId)?.toolCalls;
    },
    [agentContext]
  );
  const messageToolCalls = useAgentStore(agentToolCallsSelector);

  const displayedToolCalls = useMemo(() => {
    if (Array.isArray(messageToolCalls)) return messageToolCalls;
    if (Array.isArray(session?.toolCalls)) return session.toolCalls;
    return [];
  }, [messageToolCalls, session?.toolCalls]);

  const hasStreamingCalls = session?.status === 'running' && (session.toolCallProgress?.length ?? 0) > 0;
  const cards = useMemo(
    () => (displayedToolCalls.length > 0 ? buildEditCardsFromToolCallMetadata(displayedToolCalls) : []),
    [displayedToolCalls]
  );
  const hasCards = cards.length > 0;
  const hasToolCalls = hasStreamingCalls || hasCards;

  useEffect(() => {
    if (hasToolCalls) {
      setOutputExpanded(false);
    } else {
      setOutputExpanded(true);
    }
  }, [hasToolCalls]);

  const statusLabel = useMemo(() => {
    if (!session) return '';
    switch (session.status) {
      case 'pending_confirmation':
        return 'Needs confirmation';
      case 'applying':
        return 'Applying...';
      default:
        return session.status;
    }
  }, [session?.status]);

  const userInput = useMemo(() => {
    if (!session) return '';
    if (session.kind === 'agent') return ((session.input as any)?.userInput as string | undefined) ?? '';
    return '';
  }, [session?.kind, session?.input]);

  const contentText = useMemo(() => {
    if (!session) return '';
    return session.contentParts
      .filter((part) => part.type === 'content')
      .map((part) => part.text)
      .join('');
  }, [session?.contentParts]);

  const projectId = agentContext?.projectId ?? ((session?.input as any)?.projectId as string | undefined) ?? '';
  const hasPendingCards = displayedToolCalls.some((toolCall: any) => isPendingStatus(toolCall?.status));
  const isPending = hasPendingCards || isApplying;

  const handleRetry = useCallback(() => {
    if (!session) return;
    if (session.kind === 'agent') {
      void AgentExecutor.start(session.input as AgentExecutorInput);
    } else if (session.kind === 'agentTranslation') {
      void AgentExecutor.translate(session.input as AgentTranslationInput);
    }
    closeDetailModal();
  }, [session?.id, session?.kind, session?.input, closeDetailModal]);

  const handleCancel = useCallback(() => {
    if (!session) return;
    cancelSession(session.id);
  }, [cancelSession, session?.id]);

  const handleConfirm = useCallback(async (decisions: ToolCallDecisionMap) => {
    if (!agentContext) return;

    setIsApplying(true);
    try {
      const invocationCaller: InvocationCaller | undefined = agentContext.runMode;
      await executeAgentToolCalls({
        projectId: agentContext.projectId,
        agentId: agentContext.agentId,
        assistantMessageId: agentContext.assistantMessageId,
        language: mainLanguage,
        decisions,
        options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
        invocationCaller,
      });
    } finally {
      setIsApplying(false);
    }
  }, [agentContext, mainLanguage]);

  if (!session) return null;

  const footer = (
    <div className="llm-task-modal-footer-actions">
      {(session.status === 'error' || session.status === 'cancelled') && (
        <TextButton variant="secondary" onClick={handleRetry}>
          Retry
        </TextButton>
      )}
      {session.status === 'running' && (
        <TextButton variant="danger" onClick={handleCancel}>
          Cancel
        </TextButton>
      )}
    </div>
  );

  return (
    <BaseModal
      isOpen={true}
      onClose={closeDetailModal}
      showHeader={false}
      className="llm-task-modal-modal"
      size="large"
      footer={<div className="llm-task-modal-footer">{footer}</div>}
    >
      <div className="llm-task-modal-header">
        <div className="llm-task-modal-title">
          <h3>{session.label}</h3>
          <span className={`llm-task-modal-status llm-task-modal-status--${session.status}`}>
            {statusLabel}
          </span>

          {session.status === 'error' && session.error && (
            <div
              className={`llm-task-modal-error-container ${errorExpanded ? 'llm-task-modal-error-container--expanded' : ''}`}
              onClick={() => setErrorExpanded((prev) => !prev)}
            >
              <div className="llm-task-modal-error-summary-text">{session.error}</div>
            </div>
          )}

          {session.warning && (
            <div className="llm-task-modal-warning-container">
              <div className="llm-task-modal-warning-text">{session.warning}</div>
            </div>
          )}
        </div>

        <IconButton
          icon={<Close size="sm" />}
          onClick={closeDetailModal}
          title="Close"
          size="sm"
          className="llm-task-modal-close"
        />
      </div>

      {session.status === 'running' && session.progress && (
        <div className="llm-task-modal-progress">
          <div className="llm-task-modal-progress-text">
            {session.progress.currentItemLabel || `${session.progress.current}/${session.progress.total}`}
          </div>
          <NotificationProgressBar current={session.progress.current} total={session.progress.total} />
        </div>
      )}

      {userInput.trim() && (
        <div className="llm-task-modal-user-input">
          <div className="llm-task-modal-user-input-label">Input</div>
          <div className="llm-task-modal-user-input-content">{userInput}</div>
        </div>
      )}

      <div className="llm-task-modal-body" ref={bodyRef} onScroll={handleBodyScroll}>
        {session.contentParts.length > 0 && (
          <div className="llm-task-modal-thinking">
            <ThinkingDisplay
              messageId={session.id}
              contentParts={session.contentParts}
              isStreaming={session.status === 'running'}
            />
          </div>
        )}

        <div className="llm-task-modal-stream">
          <button
            className="llm-task-modal-stream-toggle"
            onClick={() => setOutputExpanded((prev) => !prev)}
          >
            <span className="toggle-icon">{outputExpanded ? '-' : '+'}</span>
            <span className="llm-task-modal-stream-label">Output</span>
          </button>
          {outputExpanded && (
            <div className="llm-task-modal-stream-content">
              {contentText || <span className="llm-task-modal-waiting">Waiting...</span>}
            </div>
          )}
        </div>

        {hasStreamingCalls && (
          <div className="llm-task-modal-tool-calls">
            <FunctionCallsThread
              threadId={`llm-session:${session.id}:stream`}
              mode="streaming"
              streamingProgress={session.toolCallProgress}
              projectId={projectId}
            />
          </div>
        )}

        {hasCards && (
          <div className="llm-task-modal-tool-calls">
            <FunctionCallsThread
              threadId={`llm-session:${session.id}:cards`}
              mode={isPending ? 'pending' : 'confirmed'}
              cards={cards}
              onCommitDecisions={isPending ? handleConfirm : undefined}
              projectId={projectId}
              isApplyDisabled={isApplying}
              applyDisabledReason={isApplying ? 'Applying changes...' : undefined}
            />
          </div>
        )}
      </div>
    </BaseModal>
  );
};

export default LLMTaskModals;

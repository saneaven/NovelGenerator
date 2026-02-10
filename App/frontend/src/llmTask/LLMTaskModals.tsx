/**
 * Agent Detail Modal
 * Renders modal for agent session details from llmSessionStore
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { BaseModal } from '../components/BaseModal';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { useAgentUIStore } from '../store/agentUIStore';
import { useSettingsStore } from '../store/settingsStore';
import ThinkingDisplay from '../components/common/ThinkingDisplay';
import NotificationProgressBar from '../components/Notification/NotificationProgressBar';
import { Close } from '../components/icons';
import { TextButton } from '../components/TextButton';
import { IconButton } from '../components/IconButton';
import { FunctionCallsThread } from '../components/functionCalls';
import {
  AgentExecutor,
  type AgentExecutorInput,
  type AgentTranslationInput,
  applyAgentEdits,
} from '../agent';
import type { InvocationCaller } from '../types/agentRuntime';
import { CRUD_OPTIONS } from '../toolCall/apply/types';
import type { ToolCallDecisionMap } from '../toolCall/types';
import './LLMTaskModals.css';

export const LLMTaskModals: React.FC = () => {
  // Read from agent UI store
  const detailSessionId = useAgentUIStore((s) => s.detailSessionId);
  const closeDetailModal = useAgentUIStore((s) => s.closeDetailModal);

  const session = useLLMSessionStore((s) =>
    detailSessionId ? s.sessions[detailSessionId] : null
  );
  const cancelSession = useLLMSessionStore((s) => s.cancelSession);
  const mainLanguage = useSettingsStore((s) => s.getSettings().mainLanguage);

  const [outputExpanded, setOutputExpanded] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);

  // Auto-scroll to bottom unless user has scrolled up
  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  // Reset scroll state when session changes
  useEffect(() => {
    userScrolledUpRef.current = false;
  }, [detailSessionId]);

  // Handle scroll events to detect if user scrolled up
  const handleBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const threshold = 50;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    userScrolledUpRef.current = !isAtBottom;
  }, []);

  // Auto-scroll to bottom when content changes
  const lastContentPart = session?.contentParts?.[session.contentParts.length - 1]?.text ?? '';
  const toolCallProgressLength = session?.toolCallProgress?.length ?? 0;

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lastContentPart, toolCallProgressLength, session?.status]);

  const hasStreamingCalls = session?.status === 'running' && (session.toolCallProgress?.length ?? 0) > 0;
  const hasCards = (session?.editCards?.length ?? 0) > 0;
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
      .filter(p => p.type === 'content')
      .map(p => p.text)
      .join('');
  }, [session?.contentParts]);

  const projectId = ((session?.input as any)?.projectId as string | undefined) ?? '';

  const isApplying = session?.status === 'applying';
  const hasPendingCards = session?.editCards?.some(
    c => c.toolCall.status === 'pending' || c.toolCall.status === 'validating'
  ) ?? false;
  const isPending = session?.status === 'pending_confirmation' || isApplying || hasPendingCards;

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
    if (!projectId || !session) return;
    const invocationCaller: InvocationCaller | undefined =
      session.kind === 'agent'
        ? (session.input as AgentExecutorInput).runMode
        : undefined;
    await applyAgentEdits({
      sessionId: session.id,
      projectId,
      language: mainLanguage,
      decisions,
      options: { ...CRUD_OPTIONS, userRequest: 'Agent' },
      invocationCaller,
    });
  }, [projectId, session?.id, mainLanguage]);

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
              onClick={() => setErrorExpanded(prev => !prev)}
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
            onClick={() => setOutputExpanded(prev => !prev)}
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
              cards={session.editCards}
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

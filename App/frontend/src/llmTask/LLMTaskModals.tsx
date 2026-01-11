/**
 * LLM Task Modals
 * Renders modals based on llmTaskStore modal state
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BaseModal } from '../components/BaseModal';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { useSettingsStore } from '../store/settingsStore';
import ThinkingDisplay from '../components/ThinkingDisplay';
import NotificationProgressBar from '../components/Notification/NotificationProgressBar';
import { Close } from '../components/icons';
import { TextButton } from '../components/TextButton';
import { IconButton } from '../components/IconButton';
import { FunctionCallCard } from '../components/functionCall';
import { buildEditCardsFromFunctionCallMetadata } from '../functionCall';
import { TaskRuntime, type TaskSessionState } from '.';
import { applySessionEdits, rejectAllSessionEdits } from './functionCalls/functionCallEngine';
import { JourneyRuntime, applyJourneyEdits, rejectAllJourneyEdits } from '../llmTaskJourney';
import type { HandlerOptions } from '../functionCall/applicator/types';
import { CRUD_OPTIONS, TRANSLATION_OPTIONS } from '../functionCall/applicator/types';
import './LLMTaskModals.css';

function getApplyLanguage(session: TaskSessionState, mainLanguage: string): string {
  if (session.kind === 'translateObjects') {
    return ((session.input as any)?.targetLanguage as string | undefined) ?? mainLanguage;
  }
  return mainLanguage;
}

function getHandlerOptions(session: TaskSessionState): HandlerOptions {
  if (session.kind === 'translateObjects') {
    const userInput = ((session.input as any)?.userInput as string | undefined)?.trim();
    return { ...TRANSLATION_OPTIONS, userRequest: userInput || TRANSLATION_OPTIONS.userRequest };
  }

  if (session.kind === 'aiEdit') {
    const userRequest = ((session.input as any)?.userRequest as string | undefined)?.trim();
    return { ...CRUD_OPTIONS, userRequest: userRequest || CRUD_OPTIONS.userRequest };
  }

  if (session.kind === 'agent') {
    return { ...CRUD_OPTIONS, userRequest: 'Agent' };
  }

  return CRUD_OPTIONS;
}

export const LLMTaskModals: React.FC = () => {
  const detailSessionId = useLLMTaskStore((s) => s.detailSessionId);
  const session = useLLMTaskStore((s) =>
    detailSessionId ? s.sessions[detailSessionId] : null
  );
  const closeDetail = useLLMTaskStore((s) => s.closeDetail);
  const clearNotification = useLLMTaskStore((s) => s.clearNotification);
  const cancelTask = useLLMTaskStore((s) => s.cancelTask);
  const mainLanguage = useSettingsStore((s) => s.settings.mainLanguage);

  const [outputExpanded, setOutputExpanded] = useState(false);
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

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
    const threshold = 50; // pixels from bottom
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    userScrolledUpRef.current = !isAtBottom;
  }, []);

  // Auto-scroll to bottom when content changes (if user hasn't scrolled up)
  const journeyMessagesLength = session?.journey?.messages?.length ?? 0;
  const lastContentPart = session?.contentParts?.[session.contentParts.length - 1]?.text ?? '';
  const functionCallProgressLength = session?.functionCallProgress?.length ?? 0;

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [journeyMessagesLength, lastContentPart, functionCallProgressLength, session?.status]);

  useEffect(() => {
    setFeedbackOpen(false);
    setFeedbackText('');
  }, [detailSessionId]);

  const hasStreamingCalls = session?.status === 'running' && (session.functionCallProgress?.length ?? 0) > 0;
  const hasCards = (session?.editCards?.length ?? 0) > 0;
  const hasFunctionCalls = hasStreamingCalls || hasCards;

  useEffect(() => {
    if (hasFunctionCalls) {
      setOutputExpanded(false);
    } else {
      setOutputExpanded(true);
    }
  }, [hasFunctionCalls]);

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
    if (session.kind === 'aiEdit') return ((session.input as any)?.userRequest as string | undefined) ?? '';
    if (session.kind === 'translateObjects') return ((session.input as any)?.userInput as string | undefined) ?? '';
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
  const applyLanguage = useMemo(() => session ? getApplyLanguage(session, mainLanguage) : mainLanguage, [session, mainLanguage]);
  const handlerOptions = useMemo(() => session ? getHandlerOptions(session) : CRUD_OPTIONS, [session]);

  const isApplying = session?.status === 'applying';
  const hasPendingCards = session?.editCards?.some(
    c => c.functionCall.status === 'pending' || c.functionCall.status === 'validating'
  ) ?? false;
  const isPending = session?.status === 'pending_confirmation' || isApplying || hasPendingCards;

  const handleDismissToast = useCallback(() => {
    if (detailSessionId) {
      clearNotification(detailSessionId);
    }
    closeDetail();
  }, [detailSessionId, clearNotification, closeDetail]);

  const handleRetry = useCallback(() => {
    if (!session) return;
    TaskRuntime.retry(session.id);
    closeDetail();
  }, [session?.id, closeDetail]);

  const handleCancel = useCallback(() => {
    if (!session) return;
    cancelTask(session.id);
  }, [cancelTask, session?.id]);

  const handleConfirm = useCallback(async (selections: Record<string, boolean>) => {
    if (!projectId || !session) return;
    if (session.journey) {
      await applyJourneyEdits({
        sessionId: session.id,
        projectId,
        language: applyLanguage,
        selections,
        options: handlerOptions,
      });
    } else {
      await applySessionEdits({
        sessionId: session.id,
        projectId,
        language: applyLanguage,
        selections,
        options: handlerOptions,
      });
    }
  }, [projectId, session?.id, applyLanguage, handlerOptions]);

  const handleRejectAll = useCallback(() => {
    if (!session) return;
    if (session.journey) {
      rejectAllJourneyEdits({ sessionId: session.id });
    } else {
      rejectAllSessionEdits({ sessionId: session.id });
    }
  }, [session?.id]);

  const handleSendFeedback = useCallback(() => {
    if (!session) return;
    const text = feedbackText.trim();
    if (!text) return;
    JourneyRuntime.sendFeedback({ sessionId: session.id, text });
    setFeedbackText('');
    setFeedbackOpen(false);
  }, [session, feedbackText]);

  const isJourney = Boolean(session?.journey);

  // Find the last assistant message ID (used for showing current function calls)
  const lastAssistantMessageId = useMemo(() => {
    if (!session?.journey) return null;
    for (let i = session.journey.messages.length - 1; i >= 0; i--) {
      const msg = session.journey.messages[i];
      if (msg.role === 'assistant') return msg.id;
    }
    return null;
  }, [session?.journey]);

  // Track if we're currently streaming
  const isStreamingStatus = session?.status === 'running';

  if (!session) return null;

  const footer = (
    <div className="llm-task-modal-footer-actions">
      <TextButton variant="secondary" onClick={handleDismissToast}>
        Dismiss
      </TextButton>
      {!isJourney && (session.status === 'error' || session.status === 'cancelled') && (
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
      onClose={closeDetail}
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
          onClick={closeDetail}
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
        {isJourney && (
          <div className="llm-task-modal-journey">
            <div className="llm-task-modal-journey-label">Journey</div>
            <div className="llm-task-modal-journey-messages">
              {(session.journey?.messages ?? []).length === 0 && (
                <div className="llm-task-modal-no-content">No messages yet.</div>
              )}
              {(session.journey?.messages ?? []).map((m) => {
                const text = m.contentParts
                  .filter(p => p.type === 'content')
                  .map(p => p.text)
                  .join('')
                  .trim();

                const isLastAssistant = m.id === lastAssistantMessageId;
                const storedFunctionCalls = m.functionCalls ?? [];
                const historicalCards = !isLastAssistant && storedFunctionCalls.length > 0
                  ? buildEditCardsFromFunctionCallMetadata(storedFunctionCalls)
                  : [];

                // Check if this message has any function calls (historical or current)
                const messageHasFunctionCalls = historicalCards.length > 0 ||
                  (isLastAssistant && (hasStreamingCalls || hasCards));

                // Hide content area if assistant has no text but has function calls
                const showContent = text || (m.role === 'assistant' && !messageHasFunctionCalls);

                return (
                  <div key={m.id} className={`llm-task-modal-journey-message llm-task-modal-journey-message--${m.role}`}>
                    <div className="llm-task-modal-journey-message-role">
                      {m.role === 'user' ? 'User' : m.role === 'assistant' ? 'AI' : m.role}
                    </div>
                    {m.role === 'assistant' && (
                      <ThinkingDisplay
                        messageId={m.id}
                        contentParts={m.contentParts}
                        isStreaming={isStreamingStatus && m.id === lastAssistantMessageId}
                      />
                    )}
                    {showContent && (
                      <div className="llm-task-modal-journey-message-content">
                        {text || (m.role === 'assistant' ? <span className="llm-task-modal-waiting">Waiting...</span> : null)}
                      </div>
                    )}

                    {/* Function calls inside AI message frame */}
                    {m.role === 'assistant' && (
                      <>
                        {/* Historical function calls */}
                        {historicalCards.length > 0 && (
                          <div className="llm-task-modal-journey-message-function-calls">
                            <FunctionCallCard
                              mode="confirmed"
                              cards={historicalCards}
                              projectId={projectId}
                            />
                          </div>
                        )}

                        {/* Current streaming function calls */}
                        {isLastAssistant && hasStreamingCalls && (
                          <div className="llm-task-modal-journey-message-function-calls">
                            <FunctionCallCard
                              mode="streaming"
                              streamingProgress={session.functionCallProgress}
                              projectId={projectId}
                            />
                          </div>
                        )}

                        {/* Current pending/confirmed function calls */}
                        {isLastAssistant && hasCards && (
                          <div className="llm-task-modal-journey-message-function-calls">
                            <FunctionCallCard
                              mode={isPending ? 'pending' : 'confirmed'}
                              cards={session.editCards}
                              onConfirm={isPending ? handleConfirm : undefined}
                              projectId={projectId}
                              isApplyDisabled={isApplying}
                              applyDisabledReason={isApplying ? 'Applying changes...' : undefined}
                            />
                            {session.status === 'pending_confirmation' && (
                              <div className="llm-task-modal-reject-all">
                                <TextButton variant="secondary" onClick={handleRejectAll}>
                                  Reject All
                                </TextButton>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Feedback section with animated expand */}
        {isJourney && (
          <div className={`llm-task-modal-feedback-container ${feedbackOpen ? 'expanded' : ''}`}>
            <button
              className="llm-task-modal-feedback-header"
              onClick={() => setFeedbackOpen(!feedbackOpen)}
              disabled={session.status === 'running' || session.status === 'applying' || session.status === 'pending_confirmation'}
            >
              {feedbackOpen ? 'Feedback' : '+ Feedback'}
            </button>

            <AnimatePresence>
              {feedbackOpen && (
                <motion.div
                  className="llm-task-modal-feedback-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                >
                  <div className="llm-task-modal-feedback-body-inner">
                    <textarea
                      className="llm-task-modal-feedback-textarea"
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Tell the AI what to change..."
                      rows={4}
                    />
                    <div className="llm-task-modal-feedback-actions">
                      <TextButton
                        variant="secondary"
                        onClick={() => setFeedbackOpen(false)}
                      >
                        Cancel
                      </TextButton>
                      <TextButton
                        variant="primary"
                        onClick={handleSendFeedback}
                        disabled={!feedbackText.trim() || session.status === 'running' || session.status === 'applying' || session.status === 'pending_confirmation'}
                      >
                        Send
                      </TextButton>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {!isJourney && session.contentParts.length > 0 && (
          <div className="llm-task-modal-thinking">
            <ThinkingDisplay
              messageId={session.id}
              contentParts={session.contentParts}
              isStreaming={session.status === 'running'}
            />
          </div>
        )}

        {!isJourney && (
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
        )}

        {/* Non-journey function calls (standalone) */}
        {!isJourney && hasStreamingCalls && (
          <div className="llm-task-modal-function-calls">
            <FunctionCallCard
              mode="streaming"
              streamingProgress={session.functionCallProgress}
              projectId={projectId}
            />
          </div>
        )}

        {!isJourney && hasCards && (
          <div className="llm-task-modal-function-calls">
            <FunctionCallCard
              mode={isPending ? 'pending' : 'confirmed'}
              cards={session.editCards}
              onConfirm={isPending ? handleConfirm : undefined}
              projectId={projectId}
              isApplyDisabled={isApplying}
              applyDisabledReason={isApplying ? 'Applying changes...' : undefined}
            />
            {session.status === 'pending_confirmation' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <TextButton variant="secondary" onClick={handleRejectAll}>
                  Reject All
                </TextButton>
              </div>
            )}
          </div>
        )}
      </div>
    </BaseModal>
  );
};

export default LLMTaskModals;

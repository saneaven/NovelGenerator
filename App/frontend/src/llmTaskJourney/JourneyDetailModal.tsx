/**
 * Journey Detail Modal
 * Renders modal for journey details from journeyStore
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BaseModal } from '../components/BaseModal';
import { useJourneyStore, type Journey } from '../store/journeyStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { useSettingsStore } from '../store/settingsStore';
import ThinkingDisplay from '../components/ThinkingDisplay';
import NotificationProgressBar from '../components/Notification/NotificationProgressBar';
import { Close, Edit, Trash } from '../components/icons';
import { TextButton } from '../components/TextButton';
import { IconButton } from '../components/IconButton';
import { FunctionCallCard } from '../components/functionCall';
import { buildEditCardsFromFunctionCallMetadata } from '../functionCall';
import { JourneyRuntime, applyJourneyEdits, rejectAllJourneyEdits } from './index';
import type { HandlerOptions } from '../functionCall/applicator/types';
import { CRUD_OPTIONS, TRANSLATION_OPTIONS } from '../functionCall/applicator/types';
import '../llmTask/LLMTaskModals.css';

function getApplyLanguage(journey: Journey, mainLanguage: string): string {
  if (journey.kind === 'translateObjects') {
    return ((journey.input as any)?.targetLanguage as string | undefined) ?? mainLanguage;
  }
  return mainLanguage;
}

function getHandlerOptions(journey: Journey): HandlerOptions {
  if (journey.kind === 'translateObjects') {
    const userInput = ((journey.input as any)?.userInput as string | undefined)?.trim();
    return { ...TRANSLATION_OPTIONS, userRequest: userInput || TRANSLATION_OPTIONS.userRequest };
  }

  if (journey.kind === 'aiEdit') {
    const userRequest = ((journey.input as any)?.userRequest as string | undefined)?.trim();
    return { ...CRUD_OPTIONS, userRequest: userRequest || CRUD_OPTIONS.userRequest };
  }

  return CRUD_OPTIONS;
}

export const JourneyDetailModal: React.FC = () => {
  const detailJourneyId = useJourneyStore((s) => s.detailJourneyId);
  const closeDetailModal = useJourneyStore((s) => s.closeDetailModal);
  const clearJourney = useJourneyStore((s) => s.clearJourney);
  const cancelJourney = useJourneyStore((s) => s.cancelJourney);
  const updateMessage = useJourneyStore((s) => s.updateMessage);
  const deleteMessage = useJourneyStore((s) => s.deleteMessage);

  const journey = useJourneyStore((s) =>
    detailJourneyId ? s.journeys[detailJourneyId] : null
  );

  const mainLanguage = useSettingsStore((s) => s.settings.mainLanguage);

  const [errorExpanded, setErrorExpanded] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Auto-scroll to bottom unless user has scrolled up
  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  // Reset scroll state when journey changes
  useEffect(() => {
    userScrolledUpRef.current = false;
  }, [detailJourneyId]);

  // Handle scroll events to detect if user scrolled up
  const handleBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    const threshold = 50;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    userScrolledUpRef.current = !isAtBottom;
  }, []);

  // Auto-scroll to bottom when content changes
  const journeyMessagesLength = journey?.messages?.length ?? 0;
  const lastContentPart = journey?.currentContentParts?.[journey.currentContentParts.length - 1]?.text ?? '';
  const functionCallProgressLength = journey?.currentFunctionCallProgress?.length ?? 0;

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [journeyMessagesLength, lastContentPart, functionCallProgressLength, journey?.status]);

  useEffect(() => {
    setFeedbackOpen(false);
    setFeedbackText('');
  }, [detailJourneyId]);

  const hasStreamingCalls = journey?.status === 'running' && (journey.currentFunctionCallProgress?.length ?? 0) > 0;
  const hasCards = (journey?.editCards?.length ?? 0) > 0;

  const statusLabel = useMemo(() => {
    if (!journey) return '';
    switch (journey.status) {
      case 'pending_confirmation':
        return 'Needs confirmation';
      case 'applying':
        return 'Applying...';
      default:
        return journey.status;
    }
  }, [journey?.status]);

  const userInput = useMemo(() => {
    if (!journey) return '';
    if (journey.kind === 'aiEdit') return ((journey.input as any)?.userRequest as string | undefined) ?? '';
    if (journey.kind === 'translateObjects') return ((journey.input as any)?.userInput as string | undefined) ?? '';
    return '';
  }, [journey?.kind, journey?.input]);

  const projectId = ((journey?.input as any)?.projectId as string | undefined) ?? '';
  const applyLanguage = useMemo(() => journey ? getApplyLanguage(journey, mainLanguage) : mainLanguage, [journey, mainLanguage]);
  const handlerOptions = useMemo(() => journey ? getHandlerOptions(journey) : CRUD_OPTIONS, [journey]);

  const isApplying = journey?.status === 'applying';
  const hasPendingCards = journey?.editCards?.some(
    c => c.functionCall.status === 'pending' || c.functionCall.status === 'validating'
  ) ?? false;
  const isPending = journey?.status === 'pending_confirmation' || isApplying || hasPendingCards;

  const handleDismiss = useCallback(() => {
    if (detailJourneyId) {
      clearJourney(detailJourneyId);
    }
    closeDetailModal();
  }, [detailJourneyId, clearJourney, closeDetailModal]);

  const handleCancel = useCallback(() => {
    if (!journey) return;
    cancelJourney(journey.id);
  }, [cancelJourney, journey?.id]);

  const handleConfirm = useCallback(async (selections: Record<string, boolean>) => {
    if (!projectId || !journey) return;
    await applyJourneyEdits({
      journeyId: journey.id,
      projectId,
      language: applyLanguage,
      selections,
      options: handlerOptions,
    });
    // Clear temporary session from llmTaskStore after apply
    useLLMTaskStore.getState().clearSession(journey.id);
  }, [projectId, journey?.id, applyLanguage, handlerOptions]);

  const handleRejectAll = useCallback(() => {
    if (!journey) return;
    rejectAllJourneyEdits({ journeyId: journey.id });
    // Clear temporary session from llmTaskStore after reject
    useLLMTaskStore.getState().clearSession(journey.id);
  }, [journey?.id]);

  const handleSendFeedback = useCallback(() => {
    if (!journey) return;
    const text = feedbackText.trim();
    if (!text) return;
    JourneyRuntime.sendFeedback({ journeyId: journey.id, text });
    setFeedbackText('');
    setFeedbackOpen(false);
  }, [journey, feedbackText]);

  const handleStartEdit = useCallback((messageId: string, currentText: string) => {
    setEditingMessageId(messageId);
    setEditingText(currentText);
  }, []);

  const handleSaveEdit = useCallback((messageId: string) => {
    if (!journey) return;
    updateMessage(journey.id, messageId, editingText);
    setEditingMessageId(null);
    setEditingText('');
  }, [journey, editingText, updateMessage]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!journey) return;
    deleteMessage(journey.id, messageId);
  }, [journey, deleteMessage]);

  // Find the last assistant message ID
  const lastAssistantMessageId = useMemo(() => {
    if (!journey) return null;
    for (let i = journey.messages.length - 1; i >= 0; i--) {
      const msg = journey.messages[i];
      if (msg.role === 'assistant') return msg.id;
    }
    return null;
  }, [journey?.messages]);

  const isStreamingStatus = journey?.status === 'running';

  if (!journey) return null;

  const footer = (
    <div className="llm-task-modal-footer-actions">
      <TextButton variant="secondary" onClick={handleDismiss}>
        Dismiss
      </TextButton>
      {journey.status === 'running' && (
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
          <h3>{journey.label}</h3>
          <span className={`llm-task-modal-status llm-task-modal-status--${journey.status}`}>
            {statusLabel}
          </span>

          {journey.status === 'error' && journey.error && (
            <div
              className={`llm-task-modal-error-container ${errorExpanded ? 'llm-task-modal-error-container--expanded' : ''}`}
              onClick={() => setErrorExpanded(prev => !prev)}
            >
              <div className="llm-task-modal-error-summary-text">{journey.error}</div>
            </div>
          )}

          {journey.warning && (
            <div className="llm-task-modal-warning-container">
              <div className="llm-task-modal-warning-text">{journey.warning}</div>
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

      {journey.status === 'running' && journey.progress && (
        <div className="llm-task-modal-progress">
          <div className="llm-task-modal-progress-text">
            {journey.progress.currentItemLabel || `${journey.progress.current}/${journey.progress.total}`}
          </div>
          <NotificationProgressBar current={journey.progress.current} total={journey.progress.total} />
        </div>
      )}

      {userInput.trim() && (
        <div className="llm-task-modal-user-input">
          <div className="llm-task-modal-user-input-label">Input</div>
          <div className="llm-task-modal-user-input-content">{userInput}</div>
        </div>
      )}

      <div className="llm-task-modal-body" ref={bodyRef} onScroll={handleBodyScroll}>
        <div className="llm-task-modal-journey">
          <div className="llm-task-modal-journey-label">Journey</div>
          <div className="llm-task-modal-journey-messages">
            {journey.messages.length === 0 && (
              <div className="llm-task-modal-no-content">No messages yet.</div>
            )}
            {journey.messages.map((m) => {
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

              const messageHasFunctionCalls = historicalCards.length > 0 ||
                (isLastAssistant && (hasStreamingCalls || hasCards));

              const showContent = text || (m.role === 'assistant' && !messageHasFunctionCalls);
              const isEditing = editingMessageId === m.id;
              const canEditDelete = !['running', 'applying', 'pending_confirmation'].includes(journey.status);

              return (
                <div key={m.id} className={`llm-task-modal-journey-message llm-task-modal-journey-message--${m.role}`}>
                  <div className="llm-task-modal-journey-message-header">
                    <div className="llm-task-modal-journey-message-role">
                      {m.role === 'user' ? 'User' : m.role === 'assistant' ? 'AI' : m.role}
                    </div>
                    {canEditDelete && !isEditing && (
                      <div className="llm-task-modal-journey-message-actions">
                        <button
                          onClick={() => handleStartEdit(m.id, text)}
                          title="Edit message"
                        >
                          <Edit size="sm" />
                        </button>
                        <button
                          className="delete"
                          onClick={() => handleDeleteMessage(m.id)}
                          title="Delete message"
                        >
                          <Trash size="sm" />
                        </button>
                      </div>
                    )}
                  </div>
                  {m.role === 'assistant' && !isEditing && (
                    <ThinkingDisplay
                      messageId={m.id}
                      contentParts={m.contentParts}
                      isStreaming={isStreamingStatus && m.id === lastAssistantMessageId}
                    />
                  )}
                  {isEditing ? (
                    <>
                      <textarea
                        className="llm-task-modal-journey-message-edit-textarea"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        autoFocus
                      />
                      <div className="llm-task-modal-journey-message-edit-actions">
                        <TextButton variant="secondary" onClick={handleCancelEdit}>
                          Cancel
                        </TextButton>
                        <TextButton variant="primary" onClick={() => handleSaveEdit(m.id)}>
                          Save
                        </TextButton>
                      </div>
                    </>
                  ) : showContent && (
                    <div className="llm-task-modal-journey-message-content">
                      {text || (m.role === 'assistant' ? <span className="llm-task-modal-waiting">Waiting...</span> : null)}
                    </div>
                  )}

                  {m.role === 'assistant' && (
                    <>
                      {historicalCards.length > 0 && (
                        <div className="llm-task-modal-journey-message-function-calls">
                          <FunctionCallCard
                            mode="confirmed"
                            cards={historicalCards}
                            projectId={projectId}
                          />
                        </div>
                      )}

                      {isLastAssistant && hasStreamingCalls && (
                        <div className="llm-task-modal-journey-message-function-calls">
                          <FunctionCallCard
                            mode="streaming"
                            streamingProgress={journey.currentFunctionCallProgress}
                            projectId={projectId}
                          />
                        </div>
                      )}

                      {isLastAssistant && hasCards && (
                        <div className="llm-task-modal-journey-message-function-calls">
                          <FunctionCallCard
                            mode={isPending ? 'pending' : 'confirmed'}
                            cards={journey.editCards}
                            onConfirm={isPending ? handleConfirm : undefined}
                            projectId={projectId}
                            isApplyDisabled={isApplying}
                            applyDisabledReason={isApplying ? 'Applying changes...' : undefined}
                          />
                          {journey.status === 'pending_confirmation' && (
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

        {/* Feedback section */}
        <div className={`llm-task-modal-feedback-container ${feedbackOpen ? 'expanded' : ''}`}>
          <button
            className="llm-task-modal-feedback-header"
            onClick={() => setFeedbackOpen(!feedbackOpen)}
            disabled={journey.status === 'running' || journey.status === 'applying' || journey.status === 'pending_confirmation'}
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
                      disabled={!feedbackText.trim() || journey.status === 'running' || journey.status === 'applying' || journey.status === 'pending_confirmation'}
                    >
                      Send
                    </TextButton>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </BaseModal>
  );
};

export default JourneyDetailModal;

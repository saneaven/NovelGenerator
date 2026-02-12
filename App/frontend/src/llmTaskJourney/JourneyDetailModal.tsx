/**
 * Journey Detail Modal
 * Renders modal for journey details from journeyStore
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BaseModal } from '../components/BaseModal';
import { useJourneyStore, type Journey } from '../store/journeyStore';
import { useLLMSessionStore } from '../store/llmSessionStore';
import { useSettingsStore } from '../store/settingsStore';
import ThinkingDisplay from '../components/common/ThinkingDisplay';
import NotificationProgressBar from '../components/Notification/NotificationProgressBar';
import { Close, Edit, Trash } from '../components/icons';
import { TextButton } from '../components/TextButton';
import { IconButton } from '../components/IconButton';
import { FunctionCallsThread } from '../toolCall/ui';
import { buildEditCardsFromToolCallMetadata } from '../toolCall';
import { JourneyRuntime, applyJourneyEdits } from './index';
import type { HandlerOptions } from '../toolCall/apply/types';
import { CRUD_OPTIONS, TRANSLATION_OPTIONS } from '../toolCall/apply/types';
import type { ToolCallDecisionMap, ToolCallStatus } from '../toolCall/types';
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

function isPendingStatus(status: string | undefined): boolean {
  const normalized = (status ?? 'pending') as ToolCallStatus;
  return normalized === 'pending' || normalized === 'validating' || normalized === 'processing' || normalized === 'running';
}

export const JourneyDetailModal: React.FC = () => {
  const detailJourneyId = useJourneyStore((state) => state.detailJourneyId);
  const closeDetailModal = useJourneyStore((state) => state.closeDetailModal);
  const cancelJourney = useJourneyStore((state) => state.cancelJourney);
  const updateMessage = useJourneyStore((state) => state.updateMessage);
  const deleteMessage = useJourneyStore((state) => state.deleteMessage);

  const journey = useJourneyStore((state) =>
    detailJourneyId ? state.journeys[detailJourneyId] : null
  );

  const session = useLLMSessionStore((state) =>
    journey?.status === 'running' && journey?.activeSessionId ? state.sessions[journey.activeSessionId] : undefined
  );

  const mainLanguage = useSettingsStore((state) => state.getSettings().mainLanguage);

  const [errorExpanded, setErrorExpanded] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    userScrolledUpRef.current = false;
  }, [detailJourneyId]);

  const handleBodyScroll = useCallback(() => {
    const element = bodyRef.current;
    if (!element) return;
    const threshold = 50;
    const isAtBottom = element.scrollHeight - element.scrollTop - element.clientHeight < threshold;
    userScrolledUpRef.current = !isAtBottom;
  }, []);

  const journeyMessagesLength = journey?.messages?.length ?? 0;
  const lastContentPart = session?.contentParts?.[session.contentParts.length - 1]?.text ?? '';
  const toolCallProgressLength = session?.toolCallProgress?.length ?? 0;

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const element = bodyRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [journeyMessagesLength, lastContentPart, toolCallProgressLength, journey?.status]);

  useEffect(() => {
    setFeedbackOpen(false);
    setFeedbackText('');
  }, [detailJourneyId]);

  const lastAssistantMessageId = useMemo(() => {
    if (!journey) return null;
    for (let i = journey.messages.length - 1; i >= 0; i--) {
      const message = journey.messages[i];
      if (message.role === 'assistant') return message.id;
    }
    return null;
  }, [journey?.messages]);

  const lastAssistantToolCalls = useMemo(() => {
    if (!journey || !lastAssistantMessageId) return [];
    const message = journey.messages.find((item) => item.id === lastAssistantMessageId);
    return message?.toolCalls ?? [];
  }, [journey, lastAssistantMessageId]);

  const hasStreamingCalls = journey?.status === 'running' && (session?.toolCallProgress?.length ?? 0) > 0;

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
  const applyLanguage = useMemo(
    () => (journey ? getApplyLanguage(journey, mainLanguage) : mainLanguage),
    [journey, mainLanguage]
  );
  const handlerOptions = useMemo(
    () => (journey ? getHandlerOptions(journey) : CRUD_OPTIONS),
    [journey]
  );

  const isApplying = journey?.status === 'applying';
  const hasPendingCards = lastAssistantToolCalls.some((toolCall) => isPendingStatus(toolCall?.status));
  const isPending = journey?.status === 'pending_confirmation' || isApplying || hasPendingCards;

  const handleCancel = useCallback(() => {
    if (!journey) return;
    cancelJourney(journey.id);
  }, [cancelJourney, journey?.id]);

  const handleConfirm = useCallback(async (decisions: ToolCallDecisionMap) => {
    if (!projectId || !journey) return;
    await applyJourneyEdits({
      journeyId: journey.id,
      projectId,
      language: applyLanguage,
      decisions,
      options: handlerOptions,
    });
  }, [projectId, journey?.id, applyLanguage, handlerOptions]);

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

  const isStreamingStatus = journey?.status === 'running';

  if (!journey) return null;

  const footer = (
    <div className="llm-task-modal-footer-actions">
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
              onClick={() => setErrorExpanded((prev) => !prev)}
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
            {journey.messages.map((message) => {
              const isLastAssistant = message.id === lastAssistantMessageId;
              const displayContentParts =
                isLastAssistant && isStreamingStatus ? (session?.contentParts ?? message.contentParts) : message.contentParts;

              const text = displayContentParts
                .filter((part) => part.type === 'content')
                .map((part) => part.text)
                .join('')
                .trim();

              const storedToolCalls = message.toolCalls ?? [];
              const messageCards = storedToolCalls.length > 0
                ? buildEditCardsFromToolCallMetadata(storedToolCalls)
                : [];

              const messageHasToolCalls =
                messageCards.length > 0 ||
                (isLastAssistant && hasStreamingCalls);

              const showContent = text || (message.role === 'assistant' && !messageHasToolCalls);
              const isEditing = editingMessageId === message.id;
              const canEditDelete = !['running', 'applying', 'pending_confirmation'].includes(journey.status);

              return (
                <div key={message.id} className={`llm-task-modal-journey-message llm-task-modal-journey-message--${message.role}`}>
                  <div className="llm-task-modal-journey-message-header">
                    <div className="llm-task-modal-journey-message-role">
                      {message.role === 'user' ? 'User' : message.role === 'assistant' ? 'AI' : message.role}
                    </div>
                    {canEditDelete && !isEditing && (
                      <div className="llm-task-modal-journey-message-actions">
                        <button
                          onClick={() => handleStartEdit(message.id, text)}
                          title="Edit message"
                        >
                          <Edit size="sm" />
                        </button>
                        <button
                          className="delete"
                          onClick={() => handleDeleteMessage(message.id)}
                          title="Delete message"
                        >
                          <Trash size="sm" />
                        </button>
                      </div>
                    )}
                  </div>

                  {message.role === 'assistant' && !isEditing && (
                    <ThinkingDisplay
                      messageId={message.id}
                      contentParts={displayContentParts}
                      isStreaming={isStreamingStatus && message.id === lastAssistantMessageId}
                    />
                  )}

                  {isEditing ? (
                    <>
                      <textarea
                        className="llm-task-modal-journey-message-edit-textarea"
                        value={editingText}
                        onChange={(event) => setEditingText(event.target.value)}
                        autoFocus
                      />
                      <div className="llm-task-modal-journey-message-edit-actions">
                        <TextButton variant="secondary" onClick={handleCancelEdit}>
                          Cancel
                        </TextButton>
                        <TextButton variant="primary" onClick={() => handleSaveEdit(message.id)}>
                          Save
                        </TextButton>
                      </div>
                    </>
                  ) : showContent && (
                    <div className="llm-task-modal-journey-message-content">
                      {text || (message.role === 'assistant' ? <span className="llm-task-modal-waiting">Waiting...</span> : null)}
                    </div>
                  )}

                  {message.role === 'assistant' && (
                    <>
                      {messageCards.length > 0 && (
                        <div className="llm-task-modal-journey-message-tool-calls">
                          <FunctionCallsThread
                            threadId={`journey:${journey.id}:${message.id}:calls`}
                            mode={isLastAssistant && isPending ? 'pending' : 'confirmed'}
                            cards={messageCards}
                            onCommitDecisions={isLastAssistant && isPending ? handleConfirm : undefined}
                            projectId={projectId}
                            isApplyDisabled={Boolean(isLastAssistant && isApplying)}
                            applyDisabledReason={isLastAssistant && isApplying ? 'Applying changes...' : undefined}
                          />
                        </div>
                      )}

                      {isLastAssistant && hasStreamingCalls && (
                        <div className="llm-task-modal-journey-message-tool-calls">
                          <FunctionCallsThread
                            threadId={`journey:${journey.id}:${message.id}:stream`}
                            mode="streaming"
                            streamingProgress={session?.toolCallProgress}
                            projectId={projectId}
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

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
                    onChange={(event) => setFeedbackText(event.target.value)}
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

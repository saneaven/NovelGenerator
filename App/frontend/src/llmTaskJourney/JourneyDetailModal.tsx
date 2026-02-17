/**
 * Journey Detail Modal
 * Reads messages and tool calls directly from ThreadStore (same pipeline as AgentPanel).
 * JourneyStore only provides metadata (kind, input, editingTargets, label, threadId).
 */

import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { BaseModal } from '../components/BaseModal';
import { useJourneyStore, type Journey } from '../store/journeyStore';
import { useSettingsStore } from '../store/settingsStore';
import ThinkingDisplay from '../components/common/ThinkingDisplay';
import { Close, Edit, Trash } from '../components/icons';
import { TextButton } from '../components/TextButton';
import { IconButton } from '../components/IconButton';
import { FunctionCallsThread } from '../toolCall/ui';
import { buildEditCardsFromToolCallMetadata } from '../toolCall';
import type { ToolCallDecisionMap } from '../toolCall/types';
import type { ToolCallMetadata } from '../types/chat';
import { useThreadStore } from '../store/threadStore';
import type { ThreadToolCall } from '../types/thread';
import { resolveRunMessageDisplay } from '../types/thread';
import type { ContentPart } from '../types/chat';
import ChatEngine from '../agent/chatEngine';

type JourneyDisplayStatus =
  | 'idle'
  | 'running'
  | 'pending_confirmation'
  | 'success'
  | 'error';

function getProjectIdFromJourney(journey: Journey): string {
  return ((journey.input as any)?.projectId as string | undefined) ?? '';
}

function getJourneyLanguage(journey: Journey): string {
  const targets = journey.editingTargets;
  if (targets.kind === 'translateObjects') return targets.targetLanguage;
  if (targets.kind === 'aiEdit') return targets.language;
  return 'English';
}

function toToolCallMetadata(toolCall: ThreadToolCall): ToolCallMetadata {
  return {
    id: toolCall.id,
    tool_name: toolCall.toolName,
    arguments: toolCall.arguments,
    status: toolCall.status as any,
    reason: toolCall.reason ?? undefined,
    result: toolCall.result as any,
    acceptedAt: toolCall.acceptedAt ? new Date(toolCall.acceptedAt) : undefined,
  };
}

function deriveJourneyDisplayStatus(params: {
  journeyError?: string;
  threadStatus: string | undefined;
  hasPendingToolCalls: boolean;
  isStreamActive: boolean;
}): JourneyDisplayStatus {
  const { journeyError, threadStatus, hasPendingToolCalls, isStreamActive } = params;
  if (journeyError) return 'error';
  if (!threadStatus) return 'idle';
  if (isStreamActive) return 'running';
  if (threadStatus === 'error') return 'error';
  if (hasPendingToolCalls) return 'pending_confirmation';
  if (threadStatus === 'waiting' || threadStatus === 'paused') return 'pending_confirmation';
  if (threadStatus === 'running' || threadStatus === 'processing') return 'running';
  if (threadStatus === 'done' || threadStatus === 'canceled') return 'success';
  return 'idle';
}

function getStatusLabel(status: JourneyDisplayStatus): string {
  switch (status) {
    case 'pending_confirmation':
      return 'Needs confirmation';
    case 'running':
      return 'Running';
    case 'success':
      return 'Completed';
    case 'error':
      return 'Error';
    default:
      return status;
  }
}

export const JourneyDetailModal: React.FC = () => {
  const detailJourneyId = useJourneyStore((state) => state.detailJourneyId);
  const closeDetailModal = useJourneyStore((state) => state.closeDetailModal);

  const journey = useJourneyStore((state) =>
    detailJourneyId ? state.journeys[detailJourneyId] : null
  );

  const threadId = journey?.threadId;

  // Messages from ThreadStore (inline replaces deleted useConversationTimeline)
  const threadMessages = useThreadStore(
    useShallow((state) => (threadId ? state.messagesByThreadId[threadId] : undefined)),
  );
  const timelineMessages = useMemo(() => {
    if (!threadId || !threadMessages) return [];
    return [...threadMessages].sort((a, b) => {
      const aSit = a.seqInThread ?? Number.MAX_SAFE_INTEGER;
      const bSit = b.seqInThread ?? Number.MAX_SAFE_INTEGER;
      if (aSit !== bSit) return aSit - bSit;
      return a.createdAt.localeCompare(b.createdAt);
    });
  }, [threadId, threadMessages]);

  // Thread state from ThreadStore
  const { toolCallsByMessageId, threadStatus, threadError, pendingToolCallMessageId, isStreamActive } = useThreadStore(
    useShallow((state) => ({
      toolCallsByMessageId: state.toolCallsByMessageId,
      threadStatus: threadId ? state.threadsById[threadId]?.status : undefined,
      threadError: threadId ? state.threadsById[threadId]?.lastError ?? null : null,
      pendingToolCallMessageId: threadId ? state.pendingToolCallMessageByThread[threadId] : undefined,
      isStreamActive: threadId ? Boolean(state.activeStreamByThread[threadId]) : false,
    }))
  );

  const mainLanguage = useSettingsStore((state) => state.getSettings().mainLanguage);
  const journeyLanguage = useMemo(() => journey ? getJourneyLanguage(journey) : mainLanguage, [journey, mainLanguage]);

  const [errorExpanded, setErrorExpanded] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const engineRef = useRef<ChatEngine | null>(null);

  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  useEffect(() => {
    if (!threadId || !journey) {
      engineRef.current?.dispose();
      engineRef.current = null;
      return;
    }

    const engine = new ChatEngine({
      threadId,
      projectId: getProjectIdFromJourney(journey),
      threadType: 'journey',
    });
    engineRef.current = engine;
    void engine.init().catch((error) => {
      console.error('Failed to init journey engine', { threadId, error });
    });

    return () => {
      if (engineRef.current === engine) {
        engine.dispose();
        engineRef.current = null;
      }
    };
  }, [threadId, journey]);

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

  // Auto-scroll
  const messagesLength = timelineMessages.length;
  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const element = bodyRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [messagesLength, threadStatus, isStreamActive]);

  useEffect(() => {
    setFeedbackOpen(false);
    setFeedbackText('');
  }, [detailJourneyId]);

  // Filter to user/assistant messages
  const displayMessages = useMemo(
    () => timelineMessages.filter(m => m.role === 'user' || m.role === 'assistant'),
    [timelineMessages]
  );

  const lastAssistantMessage = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg = displayMessages[i];
      if (msg.role === 'assistant' && !msg.isStreaming) return msg;
    }
    return null;
  }, [displayMessages]);

  const lastAssistantMessageId = lastAssistantMessage?.id ?? null;

  const lastAssistantToolCalls = useMemo(() => {
    if (!lastAssistantMessageId) return [];
    return (toolCallsByMessageId[lastAssistantMessageId] ?? []).map(toToolCallMetadata);
  }, [lastAssistantMessageId, toolCallsByMessageId]);

  const hasPendingToolCalls = useMemo(
    () => lastAssistantToolCalls.some(tc => tc.status === 'pending' || tc.status === 'streaming' || tc.status === 'validating' || tc.status === 'processing'),
    [lastAssistantToolCalls]
  );

  const journeyStatus = useMemo(() => deriveJourneyDisplayStatus({
    journeyError: journey?.error,
    threadStatus,
    hasPendingToolCalls,
    isStreamActive,
  }), [journey?.error, threadStatus, hasPendingToolCalls, isStreamActive]);

  const statusLabel = getStatusLabel(journeyStatus);

  const userInput = useMemo(() => {
    if (!journey) return '';
    if (journey.kind === 'aiEdit') return ((journey.input as any)?.userRequest as string | undefined) ?? '';
    if (journey.kind === 'translateObjects') return ((journey.input as any)?.userInput as string | undefined) ?? '';
    return '';
  }, [journey?.kind, journey?.input]);

  const projectId = journey ? getProjectIdFromJourney(journey) : '';

  const isPending = journeyStatus === 'pending_confirmation' || hasPendingToolCalls;

  const handleCancel = useCallback(() => {
    void engineRef.current?.cancel();
  }, []);

  const handleConfirm = useCallback(async (decisions: ToolCallDecisionMap) => {
    if (!engineRef.current) return;
    const accepts = Object.entries(decisions)
      .filter(([, d]) => d === 'accept')
      .map(([id]) => id);
    const rejects = Object.entries(decisions)
      .filter(([, d]) => d === 'reject')
      .map(([id]) => id);
    if (accepts.length > 1 && rejects.length === 0) {
      await engineRef.current.acceptToolCallsBatch(accepts);
      return;
    }
    await Promise.all([
      ...accepts.map((id) => engineRef.current?.acceptToolCall(id)),
      ...rejects.map((id) => engineRef.current?.rejectToolCall(id)),
    ]);
  }, []);

  const handleSendFeedback = useCallback(() => {
    if (!feedbackText.trim()) return;
    void engineRef.current?.send(feedbackText);
    setFeedbackText('');
    setFeedbackOpen(false);
  }, [feedbackText]);

  const handleStartEdit = useCallback((messageId: string, currentText: string) => {
    setEditingMessageId(messageId);
    setEditingText(currentText);
  }, []);

  const handleSaveEdit = useCallback((messageId: string) => {
    if (!journey?.threadId) return;
    const entry = {
      contentParts: [{ type: 'content', text: editingText }],
      thinkingDetails: [],
    };
    useThreadStore.getState().updateMessageData(journey.threadId, messageId, journeyLanguage, entry);
    setEditingMessageId(null);
    setEditingText('');
  }, [journey?.threadId, editingText, journeyLanguage]);

  const handleCancelEdit = useCallback(() => {
    setEditingMessageId(null);
    setEditingText('');
  }, []);

  const handleDeleteMessage = useCallback((messageId: string) => {
    if (!journey?.threadId) return;
    useThreadStore.getState().removeMessage(journey.threadId, messageId);
  }, [journey?.threadId]);

  const displayError = useMemo(() => {
    if (journey?.error) return journey.error;
    if (threadError) return threadError;
    return null;
  }, [journey?.error, threadError]);

  if (!journey) return null;

  const isRunning = journeyStatus === 'running';
  const canEditDelete = !['running', 'pending_confirmation'].includes(journeyStatus);
  const isFeedbackDisabled = isRunning || journeyStatus === 'pending_confirmation';

  const footer = (
    <div className="llm-task-modal-footer-actions">
      {isRunning && (
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
          <span className={`llm-task-modal-status llm-task-modal-status--${journeyStatus}`}>
            {statusLabel}
          </span>

          {journeyStatus === 'error' && displayError && (
            <div
              className={`llm-task-modal-error-container ${errorExpanded ? 'llm-task-modal-error-container--expanded' : ''}`}
              onClick={() => setErrorExpanded((prev) => !prev)}
            >
              <div className="llm-task-modal-error-summary-text">{displayError}</div>
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
            {displayMessages.length === 0 && (
              <div className="llm-task-modal-no-content">No messages yet.</div>
            )}
            {displayMessages.map((message) => {
              const isLastAssistant = message.id === lastAssistantMessageId;
              const isStreamingMessage = message.isStreaming === true;

              // Resolve display content from multilingual data
              const resolved = isStreamingMessage
                ? {
                    contentParts: (message.streamingData?.contentParts ?? []),
                    thinkingDetails: message.streamingData?.thinkingDetails,
                  }
                : resolveRunMessageDisplay(message, journeyLanguage);
              const displayContentParts = (resolved.contentParts ?? []).map((part) => ({
                type: part.type === 'thinking' ? 'thinking' : 'content',
                text: String(part.text ?? ''),
              })) as ContentPart[];

              const text = resolved.contentParts
                .filter((part) => part.type === 'content')
                .map((part) => part.text)
                .join('')
                .trim();

              // Tool calls from ThreadStore
              const storedToolCalls = !isStreamingMessage
                ? (toolCallsByMessageId[message.id] ?? []).map(toToolCallMetadata)
                : [];
              const messageCards = storedToolCalls.length > 0
                ? buildEditCardsFromToolCallMetadata(storedToolCalls)
                : [];

              const messageHasToolCalls = messageCards.length > 0;
              const showContent = text || (message.role === 'assistant' && !messageHasToolCalls);
              const isEditing = editingMessageId === message.id;

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
                      isStreaming={isStreamingMessage}
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
                            isApplyDisabled={false}
                            applyDisabledReason={undefined}
                          />
                        </div>
                      )}

                      {!messageCards.length && pendingToolCallMessageId === message.id && (
                        <div className="llm-task-modal-journey-message-tool-calls">
                          <div className="typing-indicator">
                            <div className="loading-track">
                              <div className="loading-bar" />
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {isRunning && displayMessages.length > 0 && !displayMessages.some(m => m.isStreaming) && (
              <div className="typing-indicator">
                <div className="loading-track">
                  <div className="loading-bar" />
                </div>
              </div>
            )}
          </div>
        </div>

        <div className={`llm-task-modal-feedback-container ${feedbackOpen ? 'expanded' : ''}`}>
          <button
            className="llm-task-modal-feedback-header"
            onClick={() => setFeedbackOpen(!feedbackOpen)}
            disabled={isFeedbackDisabled}
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
                      disabled={!feedbackText.trim() || isFeedbackDisabled}
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

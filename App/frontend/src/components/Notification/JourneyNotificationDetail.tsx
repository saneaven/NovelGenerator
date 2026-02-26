import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { BaseModal } from '../BaseModal';
import { useThreadStore } from '../../store/threadStore';
import { useSettingsStore } from '../../store/settingsStore';
import { threadService } from '../../api/threadService';
import {
  sendThreadMessage,
  cancelThread,
  decideToolCall,
  decideToolCallsBatch,
} from '../../runtime/threadCommands';
import { resolveRunMessageDisplay } from '../../types/thread';
import type { ThreadMessage, ThreadToolCall } from '../../types/thread';
import type { ToolCallMetadata } from '../../types/chat';
import type { ToolCallDecisionMap } from '../../toolCall/types';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { FunctionCallsThread } from '../../toolCall/ui';
import ThinkingDisplay from '../common/ThinkingDisplay';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { Close } from '../icons';
import { Loading } from '../common/Loading';
import './JourneyNotificationDetail.css';

interface JourneyNotificationDetailProps {
  threadId: string;
  label: string;
  status: string;
  message: string;
  warning?: string;
  projectId: string;
  onClose: () => void;
}

function toToolCallMetadata(tc: ThreadToolCall): ToolCallMetadata {
  return {
    id: tc.id,
    tool_name: tc.toolName,
    arguments: tc.arguments,
    status: tc.status as any,
    reason: tc.reason ?? undefined,
    result: tc.result as any,
    acceptedAt: tc.acceptedAt ? new Date(tc.acceptedAt) : undefined,
  };
}

function getMessageText(message: ThreadMessage, language: string): string {
  if (message.isStreaming && message.streamingData) {
    return message.streamingData.contentParts
      .filter((p) => p.type === 'content')
      .map((p) => p.text)
      .join('')
      .trim();
  }
  const resolved = resolveRunMessageDisplay(message, language);
  return resolved.contentParts
    .filter((p) => p.type === 'content')
    .map((p) => p.text)
    .join('')
    .trim();
}

function getDisplayReasoningDetail(message: ThreadMessage, language: string) {
  if (message.isStreaming && message.streamingData) {
    return message.streamingData.reasoningDetail;
  }
  const resolved = resolveRunMessageDisplay(message, language);
  return resolved.reasoningDetail;
}

type DisplayStatus = 'idle' | 'running' | 'pending_confirmation' | 'success' | 'error';

function deriveDisplayStatus(params: {
  threadStatus: string | undefined;
  hasPendingToolCalls: boolean;
  isStreamActive: boolean;
}): DisplayStatus {
  const { threadStatus, hasPendingToolCalls, isStreamActive } = params;
  if (!threadStatus) return 'idle';
  if (isStreamActive) return 'running';
  if (threadStatus === 'error') return 'error';
  if (hasPendingToolCalls) return 'pending_confirmation';
  if (threadStatus === 'waiting' || threadStatus === 'paused') return 'pending_confirmation';
  if (threadStatus === 'running' || threadStatus === 'processing') return 'running';
  if (threadStatus === 'done' || threadStatus === 'canceled') return 'success';
  return 'idle';
}

function statusLabel(status: DisplayStatus): string {
  switch (status) {
    case 'running': return 'Running';
    case 'pending_confirmation': return 'Needs confirmation';
    case 'success': return 'Completed';
    case 'error': return 'Error';
    default: return '';
  }
}

const JourneyNotificationDetail: React.FC<JourneyNotificationDetailProps> = ({
  threadId,
  label,
  warning,
  projectId,
  onClose,
}) => {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');

  const bodyRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const mainLanguage = useSettingsStore((s) => s.getSettings().mainLanguage);

  // Subscribe to ThreadStore
  const threadMessages = useThreadStore(
    useShallow((s) => s.messagesByThreadId[threadId]),
  );
  const { toolCallsById, toolCallIdsByAssistantMessageId, threadStatus, threadLastError, isStreamActive } =
    useThreadStore(
      useShallow((s) => ({
        toolCallsById: s.toolCallsById,
        toolCallIdsByAssistantMessageId: s.toolCallIdsByAssistantMessageId,
        threadStatus: s.threadsById[threadId]?.status,
        threadLastError: s.threadsById[threadId]?.lastError,
        isStreamActive: Boolean(s.activeStreamByThread[threadId]),
      })),
    );

  // Fetch messages on mount & hydrate ThreadStore
  useEffect(() => {
    // Skip hydration if SSE has already populated messages for this thread
    // (same guard as AgentPanel — avoids overwriting streaming state).
    const store = useThreadStore.getState();
    const existingMessages = store.getMessages(threadId);
    if (existingMessages.length > 0) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFetchError(null);

    void threadService
      .listMessages(threadId)
      .then((response) => {
        if (cancelled) return;
        const nextStore = useThreadStore.getState();
        nextStore.upsertThread(response.thread);
        for (const msg of response.messages) {
          nextStore.upsertMessage(msg);
        }
        if (response.toolCalls.length > 0) {
          for (const tc of response.toolCalls) {
            nextStore.upsertToolCall(tc);
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setFetchError(err instanceof Error ? err.message : 'Failed to load messages');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [threadId]);

  // Sorted messages
  const sortedMessages = useMemo(() => {
    if (!threadMessages) return [];
    return [...threadMessages]
      .sort((a, b) => {
        if (a.seqInThread !== b.seqInThread) return a.seqInThread - b.seqInThread;
        return a.createdAt.localeCompare(b.createdAt);
      });
  }, [threadMessages]);

  // Only user + assistant messages
  const displayMessages = useMemo(
    () => sortedMessages.filter((m) => m.role === 'user' || m.role === 'assistant'),
    [sortedMessages],
  );

  // Sticky message = last user message
  const stickyMessage = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === 'user') return displayMessages[i];
    }
    return null;
  }, [displayMessages]);

  // Timeline messages = all except the sticky one
  const timelineMessages = useMemo(
    () => (stickyMessage ? displayMessages.filter((m) => m.id !== stickyMessage.id) : displayMessages),
    [displayMessages, stickyMessage],
  );

  // Last assistant message (for tool call pending detection)
  const lastAssistantMessage = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const m = displayMessages[i];
      if (m.role === 'assistant' && !m.isStreaming) return m;
    }
    return null;
  }, [displayMessages]);

  const lastAssistantToolCalls = useMemo(() => {
    if (!lastAssistantMessage) return [];
    const tcIds = toolCallIdsByAssistantMessageId[lastAssistantMessage.id] ?? [];
    return tcIds
      .map((id) => toolCallsById[id])
      .filter((tc): tc is ThreadToolCall => Boolean(tc))
      .map(toToolCallMetadata);
  }, [lastAssistantMessage, toolCallIdsByAssistantMessageId, toolCallsById]);

  const hasPendingToolCalls = useMemo(
    () => lastAssistantToolCalls.some(
      (tc) => tc.status === 'pending' || tc.status === 'streaming' || tc.status === 'validating' || tc.status === 'processing',
    ),
    [lastAssistantToolCalls],
  );

  const displayStatus = useMemo(
    () => deriveDisplayStatus({ threadStatus, hasPendingToolCalls, isStreamActive }),
    [threadStatus, hasPendingToolCalls, isStreamActive],
  );

  const isRunning = displayStatus === 'running';
  const isPending = displayStatus === 'pending_confirmation' || hasPendingToolCalls;
  const isFeedbackDisabled = isRunning || isPending;

  // Auto-scroll
  const handleBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    userScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 50;
  }, []);

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayMessages, threadStatus, isStreamActive]);

  // Handlers
  const handleCancel = useCallback(() => {
    void cancelThread({ threadId });
  }, [threadId]);

  const handleConfirm = useCallback(async (decisions: ToolCallDecisionMap) => {
    const accepts = Object.entries(decisions).filter(([, d]) => d === 'accept').map(([id]) => id);
    const rejects = Object.entries(decisions).filter(([, d]) => d === 'reject').map(([id]) => id);
    if (accepts.length > 1 && rejects.length === 0) {
      await decideToolCallsBatch({
        threadId,
        decisions: accepts.map((id) => ({ toolCallId: id, decision: 'accept' })),
      });
      return;
    }
    await Promise.all([
      ...accepts.map((id) => decideToolCall({ threadId, toolCallId: id, decision: 'accept' })),
      ...rejects.map((id) => decideToolCall({ threadId, toolCallId: id, decision: 'reject' })),
    ]);
  }, [threadId]);

  const handleSendFeedback = useCallback(() => {
    if (!feedbackText.trim()) return;
    void sendThreadMessage({
      threadId,
      projectId,
      threadType: 'journey',
      inputText: feedbackText,
    });
    setFeedbackText('');
    setFeedbackOpen(false);
  }, [threadId, projectId, feedbackText]);

  const handleFeedbackKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendFeedback();
      }
    },
    [handleSendFeedback],
  );

  // Render helpers
  const renderStickyText = stickyMessage ? getMessageText(stickyMessage, mainLanguage) : '';

  const renderAssistantMessage = (message: ThreadMessage, isLast: boolean) => {
    const text = getMessageText(message, mainLanguage);
    const reasoningDetail = getDisplayReasoningDetail(message, mainLanguage);

    const storedToolCalls = !message.isStreaming
      ? (toolCallIdsByAssistantMessageId[message.id] ?? [])
          .map((id) => toolCallsById[id])
          .filter((tc): tc is ThreadToolCall => Boolean(tc))
          .map(toToolCallMetadata)
      : [];
    const cards = storedToolCalls.length > 0 ? buildEditCardsFromToolCallMetadata(storedToolCalls) : [];
    const hasToolCalls = cards.length > 0;

    return (
      <div key={message.id} className="journey-detail-message journey-detail-message--assistant">
        <div className="journey-detail-message-role">AI</div>

        <ThinkingDisplay
          messageId={message.id}
          reasoningDetail={reasoningDetail}
          isStreaming={message.isStreaming === true}
        />

        {(text || !hasToolCalls) && (
          <div className="journey-detail-message-content">
            {text || (message.isStreaming ? null : <span className="journey-detail-waiting">Waiting...</span>)}
          </div>
        )}

        {hasToolCalls && (
          <div className="journey-detail-tool-calls">
            <FunctionCallsThread
              threadId={`journey:${threadId}:${message.id}:calls`}
              mode={isLast && isPending ? 'pending' : 'confirmed'}
              cards={cards}
              onCommitDecisions={isLast && isPending ? handleConfirm : undefined}
              projectId={projectId}
              isApplyDisabled={false}
              applyDisabledReason={undefined}
            />
          </div>
        )}
      </div>
    );
  };

  const renderUserMessage = (message: ThreadMessage) => {
    const text = getMessageText(message, mainLanguage);
    return (
      <div key={message.id} className="journey-detail-message journey-detail-message--user">
        <div className="journey-detail-message-role">You</div>
        <div className="journey-detail-message-content">{text}</div>
      </div>
    );
  };

  // Loading state
  if (loading) {
    return (
      <BaseModal isOpen onClose={onClose} showHeader={false} size="large" className="journey-detail-modal">
        <div className="journey-detail-header">
          <div className="journey-detail-header-left">
            <h3 className="journey-detail-title">{label}</h3>
          </div>
          <IconButton icon={<Close size="md" />} onClick={onClose} title="Close" size="md" variant="ghost" />
        </div>
        <div className="journey-detail-loading">
          <Loading size="md" />
          <span>Loading messages...</span>
        </div>
      </BaseModal>
    );
  }

  // Error state
  if (fetchError) {
    return (
      <BaseModal isOpen onClose={onClose} showHeader={false} size="large" className="journey-detail-modal">
        <div className="journey-detail-header">
          <div className="journey-detail-header-left">
            <h3 className="journey-detail-title">{label}</h3>
          </div>
          <IconButton icon={<Close size="md" />} onClick={onClose} title="Close" size="md" variant="ghost" />
        </div>
        <div className="journey-detail-error">
          <p>{fetchError}</p>
        </div>
      </BaseModal>
    );
  }

  const statusText = statusLabel(displayStatus);

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      showHeader={false}
      size="large"
      className="journey-detail-modal"
      footer={isRunning ? (
        <TextButton variant="danger" onClick={handleCancel}>Cancel</TextButton>
      ) : undefined}
    >
      {/* Header */}
      <div className="journey-detail-header">
        <div className="journey-detail-header-left">
          <h3 className="journey-detail-title">{label}</h3>
          {statusText && (
            <span className={`journey-detail-status journey-detail-status--${displayStatus}`}>
              {statusText}
            </span>
          )}
        </div>
        <div className="journey-detail-header-right">
          <IconButton icon={<Close size="md" />} onClick={onClose} title="Close" size="md" variant="ghost" />
        </div>
      </div>

      {/* Sticky user message */}
      <AnimatePresence mode="popLayout">
        {renderStickyText && (
          <motion.div
            key={stickyMessage!.id}
            className="journey-detail-sticky-user"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <div className="journey-detail-sticky-user-label">Current Request</div>
            <div className="journey-detail-sticky-user-text">{renderStickyText}</div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Warning / Error details */}
      {(warning || (displayStatus === 'error' && threadLastError)) && (
        <div className="journey-detail-warning">{warning || threadLastError}</div>
      )}

      {/* Scrollable message timeline */}
      <div className="journey-detail-body" ref={bodyRef} onScroll={handleBodyScroll}>
        {timelineMessages.length === 0 && !isRunning && (
          <div className="journey-detail-empty">No messages yet.</div>
        )}

        {timelineMessages.map((message) => {
          if (message.role === 'user') return renderUserMessage(message);
          if (message.role === 'assistant') {
            const isLastAssistant = message.id === lastAssistantMessage?.id;
            return renderAssistantMessage(message, isLastAssistant);
          }
          return null;
        })}

        {/* Streaming indicator */}
        {isRunning && displayMessages.length > 0 && !displayMessages.some((m) => m.isStreaming) && (
          <div className="journey-detail-typing">
            <div className="loading-track">
              <div className="loading-bar" />
            </div>
          </div>
        )}

        {/* Feedback area */}
        {!isRunning && displayMessages.length > 0 && (
          <div className={`journey-detail-feedback ${feedbackOpen ? 'journey-detail-feedback--open' : ''}`}>
            <button
              className="journey-detail-feedback-toggle"
              onClick={() => setFeedbackOpen(!feedbackOpen)}
              disabled={isFeedbackDisabled}
            >
              {feedbackOpen ? 'Feedback' : '+ Feedback'}
            </button>

            <AnimatePresence>
              {feedbackOpen && (
                <motion.div
                  className="journey-detail-feedback-body"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeInOut' }}
                >
                  <div className="journey-detail-feedback-inner">
                    <textarea
                      className="journey-detail-feedback-textarea"
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      onKeyDown={handleFeedbackKeyDown}
                      placeholder="Tell the AI what to change..."
                      rows={3}
                      autoFocus
                    />
                    <div className="journey-detail-feedback-actions">
                      <TextButton variant="secondary" onClick={() => setFeedbackOpen(false)}>
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
        )}
      </div>
    </BaseModal>
  );
};

export default JourneyNotificationDetail;

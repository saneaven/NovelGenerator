import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { BaseModal } from '../BaseModal';
import { useThreadStore } from '../../store/threadStore';
import { useSettingsStore } from '../../store/settingsStore';
import { threadService } from '../../api/threadService';
import {
  sendThreadMessage,
  cancelThread,
} from '../../runtime/threadCommands';
import { resolveRunMessageDisplay } from '../../types/thread';
import type { ThreadMessage, ThreadToolCall } from '../../types/thread';
import type { ToolCallMetadata } from '../../types/chat';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { FunctionCallsThread } from '../../toolCall/ui';
import { useToolCallDecisions } from '../../toolCall/useToolCallDecisions';
import ThinkingDisplay from '../common/ThinkingDisplay';
import PreexistingLiveRunNotice from '../common/PreexistingLiveRunNotice';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { Close } from '../icons';
import { Loading } from '../common/Loading';
import { useThreadLiveViewState } from '../../hooks/useThreadLiveViewState';
import { hasRenderableAssistantOutput } from '../../runtime/messageVisibility';
import { applyThreadSnapshot } from '../../runtime/threadHydration';
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
    extra_content: tc.extraContent ?? undefined,
    status: tc.status as any,
    reason: tc.reason ?? undefined,
    result: tc.result as any,
    imageRunId: tc.imageRunId ?? undefined,
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

type DisplayStatus = 'idle' | 'running' | 'processing' | 'waiting' | 'paused' | 'done' | 'canceled' | 'error';

function deriveDisplayStatus(params: {
  threadStatus: string | undefined;
  hasPendingToolCalls: boolean;
  isStreamActive: boolean;
}): DisplayStatus {
  const { threadStatus, hasPendingToolCalls, isStreamActive } = params;
  if (!threadStatus) return 'idle';
  if (threadStatus === 'processing') return 'processing';
  if (isStreamActive) return 'running';
  if (threadStatus === 'error') return 'error';
  if (hasPendingToolCalls || threadStatus === 'waiting') return 'waiting';
  if (threadStatus === 'paused') return 'paused';
  if (threadStatus === 'running') return 'running';
  if (threadStatus === 'done') return 'done';
  if (threadStatus === 'canceled') return 'canceled';
  return 'idle';
}

function statusLabel(status: DisplayStatus): string {
  switch (status) {
    case 'running': return 'Running';
    case 'processing': return 'Processing';
    case 'waiting': return 'Needs confirmation';
    case 'paused': return 'Paused';
    case 'done': return 'Completed';
    case 'canceled': return 'Canceled';
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
  const [latestRunContext, setLatestRunContext] = useState<{
    inputPayload: Record<string, any>;
    journeyTargetIds: string[];
  } | null>(null);

  const mainLanguage = useSettingsStore((s) => s.getSettings().mainLanguage);
  const liveView = useThreadLiveViewState(threadId);

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

    void threadService.listMessages(threadId)
      .then((response) => {
        if (cancelled) return;
        applyThreadSnapshot(response);
        if (response.latestRun) {
          setLatestRunContext({
            inputPayload: response.latestRun.inputPayload,
            journeyTargetIds: response.latestRun.journeyTargetIds,
          });
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
    () => sortedMessages.filter((message) => {
      if (message.role === 'user') return true;
      if (message.role !== 'assistant') return false;
      const attachedToolCalls = (toolCallIdsByAssistantMessageId[message.id] ?? [])
        .map((id) => toolCallsById[id])
        .filter((toolCall): toolCall is ThreadToolCall => Boolean(toolCall));
      return hasRenderableAssistantOutput({
        message,
        language: mainLanguage,
        toolCalls: attachedToolCalls,
      });
    }),
    [sortedMessages, toolCallIdsByAssistantMessageId, toolCallsById, mainLanguage],
  );

  const latestUserMessageId = useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i].role === 'user') return displayMessages[i].id;
    }
    return null;
  }, [displayMessages]);

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
      (tc) => tc.status === 'pending'
        || tc.status === 'streaming'
        || tc.status === 'validating'
        || tc.status === 'processing'
        || tc.status === 'working',
    ),
    [lastAssistantToolCalls],
  );

  const displayStatus = useMemo(
    () => deriveDisplayStatus({ threadStatus, hasPendingToolCalls, isStreamActive }),
    [threadStatus, hasPendingToolCalls, isStreamActive],
  );

  const isRunning = displayStatus === 'running' || displayStatus === 'processing';
  const isPending = displayStatus === 'waiting' || hasPendingToolCalls;
  const isFeedbackDisabled = isRunning || isPending;

  // Handlers
  const handleCancel = useCallback(() => {
    void cancelThread({ threadId });
  }, [threadId]);

  const { commitDecisions, commitDecisionsAndPause } = useToolCallDecisions(threadId);

  const handleSendFeedback = useCallback(() => {
    if (!feedbackText.trim()) return;
    void sendThreadMessage({
      threadId,
      projectId,
      threadType: 'journey',
      inputText: feedbackText,
      request: latestRunContext ? {
        input_payload: latestRunContext.inputPayload,
        journey_target_ids: latestRunContext.journeyTargetIds,
      } : undefined,
    });
    setFeedbackText('');
    setFeedbackOpen(false);
  }, [threadId, projectId, feedbackText, latestRunContext]);

  const handleFeedbackKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendFeedback();
      }
    },
    [handleSendFeedback],
  );

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
        <ThinkingDisplay
          messageId={message.id}
          reasoningDetail={reasoningDetail}
          isStreaming={message.isStreaming === true}
        />

        {text && (
          <div className="journey-detail-message-content">{text}</div>
        )}

        {hasToolCalls && (
          <div className="journey-detail-tool-calls">
            <FunctionCallsThread
              threadId={threadId}
              scopeKey={`journey:${threadId}:${message.id}:calls`}
              mode={isLast && isPending ? 'pending' : 'confirmed'}
              cards={cards}
              onCommitDecisions={isLast && isPending ? commitDecisions : undefined}
              onCommitDecisionsAndPause={isLast && isPending ? commitDecisionsAndPause : undefined}
              projectId={projectId}
            />
          </div>
        )}
      </div>
    );
  };

  const renderUserMessage = (message: ThreadMessage) => {
    const text = getMessageText(message, mainLanguage);
    const isStickyCurrent = message.id === latestUserMessageId;
    return (
      <div
        key={message.id}
        className={[
          'journey-detail-message',
          'journey-detail-message--user',
          isStickyCurrent ? 'journey-detail-message--sticky-current' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="journey-detail-user-bubble">
          <div className="journey-detail-message-content">{text}</div>
        </div>
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
  const hasInlineWarning = Boolean(warning || (displayStatus === 'error' && threadLastError));

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

      {/* Scrollable message timeline */}
      <div className="journey-detail-body">
        {displayMessages.length === 0 && !isRunning && !hasInlineWarning && liveView?.noticeKind !== 'preexisting_live_run' && (
          <div className="journey-detail-empty">No messages yet.</div>
        )}

        {displayMessages.map((message) => {
          if (message.role === 'user') return renderUserMessage(message);
          if (message.role === 'assistant') {
            const isLastAssistant = message.id === lastAssistantMessage?.id;
            return renderAssistantMessage(message, isLastAssistant);
          }
          return null;
        })}

        {hasInlineWarning && (
          <div className="journey-detail-warning">{warning || threadLastError}</div>
        )}

        {/* Streaming indicator */}
        {isRunning && !liveView?.hasStreamingMessage && liveView?.noticeKind === 'preexisting_live_run' && (
          <PreexistingLiveRunNotice className="journey-detail-notice" compact />
        )}

        {isRunning && !liveView?.hasStreamingMessage && liveView?.noticeKind !== 'preexisting_live_run' && displayMessages.length > 0 && (
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

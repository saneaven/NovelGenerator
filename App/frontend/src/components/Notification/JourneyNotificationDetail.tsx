import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { BaseModal } from '../BaseModal';
import { useThreadStore } from '../../store/threadStore';
import { useSettingsStore } from '../../store/settingsStore';
import { threadService } from '../../api/threadService';
import {
  cancelThread,
  resumeThread,
  sendThreadMessage,
} from '../../runtime/threadCommands';
import {
  canResumeThreadStatus,
  resolveRunMessageDisplay,
} from '../../types/thread';
import type { ThreadMessage, ThreadStatus, ThreadToolCall } from '../../types/thread';
import type { ToolCallMetadata } from '../../types/chat';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { FunctionCallsThread } from '../../toolCall/ui';
import { useToolCallDecisions } from '../../toolCall/useToolCallDecisions';
import ThinkingDisplay from '../common/ThinkingDisplay';
import PreexistingLiveRunNotice from '../common/PreexistingLiveRunNotice';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { ChevronDown, Close } from '../icons';
import { Loading } from '../common/Loading';
import { useThreadLiveViewState } from '../../hooks/useThreadLiveViewState';
import { useAutoScrollLock } from '../../hooks/useAutoScrollLock';
import { hasRenderableAssistantOutput } from '../../runtime/messageVisibility';
import { applyThreadSnapshot } from '../../runtime/threadHydration';
import type { NotificationStatus } from '../../store/notificationStore';
import { formatNotificationStatusLabelFor } from './notificationPresentation';
import './JourneyNotificationDetail.css';

interface JourneyNotificationDetailProps {
  threadId: string;
  label: string;
  status: NotificationStatus;
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

function isPendingToolCallStatus(status: ToolCallMetadata['status'] | undefined): boolean {
  return status === 'pending'
    || status === 'streaming'
    || status === 'validating'
    || status === 'processing'
    || status === 'working';
}

type LatestRunContext = {
  inputPayload: Record<string, any>;
  contextObjectIds: string[];
  journeyTargetIds: string[];
  language: string;
  runMode: 'planMode' | 'agentMode' | null;
  surface: string | null;
};

function toLatestRunContext(responseLatestRun: {
  inputPayload: Record<string, any>;
  contextObjectIds: string[];
  journeyTargetIds: string[];
  language: string;
  runMode: 'planMode' | 'agentMode' | null;
  surface: string | null;
} | null): LatestRunContext | null {
  if (!responseLatestRun) return null;
  return {
    inputPayload: responseLatestRun.inputPayload,
    contextObjectIds: responseLatestRun.contextObjectIds,
    journeyTargetIds: responseLatestRun.journeyTargetIds,
    language: responseLatestRun.language,
    runMode: responseLatestRun.runMode,
    surface: responseLatestRun.surface,
  };
}

const JourneyNotificationDetail: React.FC<JourneyNotificationDetailProps> = ({
  threadId,
  label,
  status,
  message,
  warning,
  projectId,
  onClose,
}) => {
  const [loading, setLoading] = useState(() => useThreadStore.getState().getMessages(threadId).length === 0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [footerActionInFlight, setFooterActionInFlight] = useState<'resume' | 'cancel' | null>(null);
  const [latestRunContext, setLatestRunContext] = useState<LatestRunContext | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyContentRef = useRef<HTMLDivElement | null>(null);

  const mainLanguage = useSettingsStore((s) => s.getSettings().mainLanguage);
  const liveView = useThreadLiveViewState(threadId);

  // Subscribe to ThreadStore
  const threadMessages = useThreadStore(
    useShallow((s) => s.messagesByThreadId[threadId]),
  );
  const { toolCallsById, toolCallIdsByAssistantMessageId, threadLastError, runtimeUnresolvedToolCallCount } =
    useThreadStore(
      useShallow((s) => ({
        toolCallsById: s.toolCallsById,
        toolCallIdsByAssistantMessageId: s.toolCallIdsByAssistantMessageId,
        threadLastError: s.threadsById[threadId]?.lastError,
        runtimeUnresolvedToolCallCount: s.threadsById[threadId]?.unresolvedToolCallCount ?? 0,
      })),
    );

  // Fetch the latest run context on mount. Hydrate messages only when the store is empty.
  useEffect(() => {
    const store = useThreadStore.getState();
    const existingMessages = store.getMessages(threadId);
    const shouldHydrateMessages = existingMessages.length === 0;

    let cancelled = false;
    setLatestRunContext(null);
    setFetchError(null);
    setLoading(shouldHydrateMessages);

    void threadService.listMessages(threadId)
      .then((response) => {
        if (cancelled) return;
        if (shouldHydrateMessages) {
          applyThreadSnapshot(response);
        }
        setLatestRunContext(toLatestRunContext(response.latestRun));
      })
      .catch((err) => {
        if (cancelled) return;
        if (shouldHydrateMessages) {
          setFetchError(err instanceof Error ? err.message : 'Failed to load messages');
        }
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
    () => lastAssistantToolCalls.some((tc) => isPendingToolCallStatus(tc.status)),
    [lastAssistantToolCalls],
  );

  const journeyStatus = status as ThreadStatus;
  const statusText = formatNotificationStatusLabelFor('journey', status);
  const isRunning = journeyStatus === 'running' || journeyStatus === 'processing';
  const isJourneyLive = isRunning || liveView?.noticeKind === 'preexisting_live_run';
  const isWaiting = journeyStatus === 'waiting';
  const canResume = canResumeThreadStatus(journeyStatus);
  const hasDecisionControls = hasPendingToolCalls;
  const isFeedbackDisabled = isRunning || isWaiting || hasDecisionControls || latestRunContext === null;
  const pendingToolCallCount = useMemo(
    () => lastAssistantToolCalls.filter((tc) => isPendingToolCallStatus(tc.status)).length,
    [lastAssistantToolCalls],
  );
  const unresolvedToolCallCount = runtimeUnresolvedToolCallCount > 0
    ? runtimeUnresolvedToolCallCount
    : pendingToolCallCount;

  const {
    showScrollButton,
    scrollToBottom,
    resetToBottom,
  } = useAutoScrollLock({
    scrollContainerRef: bodyRef,
    contentRef: bodyContentRef,
    active: isJourneyLive,
  });

  useEffect(() => {
    resetToBottom();
  }, [threadId, resetToBottom]);

  // Handlers
  const handleCancel = useCallback(() => {
    if (footerActionInFlight) return;
    setFooterActionInFlight('cancel');
    const op = cancelThread({ threadId });
    void op.finally(() => setFooterActionInFlight(null));
  }, [footerActionInFlight, threadId]);

  const handleResume = useCallback(() => {
    if (footerActionInFlight || unresolvedToolCallCount > 0) return;
    setFooterActionInFlight('resume');
    const op = resumeThread({
      threadId,
      projectId,
      threadType: 'journey',
    });
    void op.finally(() => setFooterActionInFlight(null));
  }, [footerActionInFlight, projectId, threadId, unresolvedToolCallCount]);

  const { commitDecisions, commitDecisionsAndPause } = useToolCallDecisions(threadId);

  const handleSendFeedback = useCallback(() => {
    if (!feedbackText.trim() || latestRunContext === null) return;
    void sendThreadMessage({
      threadId,
      projectId,
      threadType: 'journey',
      inputText: feedbackText,
      request: {
        input_payload: latestRunContext.inputPayload,
        context_object_ids: latestRunContext.contextObjectIds,
        journey_target_ids: latestRunContext.journeyTargetIds,
        language: latestRunContext.language || undefined,
        run_mode: latestRunContext.runMode || undefined,
        surface: latestRunContext.surface || undefined,
      },
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

        {message.isStreaming && (
          <div className="typing-indicator inline">
            <div className="loading-track">
              <div className="loading-bar" />
            </div>
          </div>
        )}

        {hasToolCalls && (
          <div className="journey-detail-tool-calls">
            <FunctionCallsThread
              threadId={threadId}
              scopeKey={`journey:${threadId}:${message.id}:calls`}
              mode={isLast && hasDecisionControls ? 'pending' : 'confirmed'}
              cards={cards}
              onCommitDecisions={isLast && hasDecisionControls ? commitDecisions : undefined}
              onCommitDecisionsAndPause={isLast && isWaiting && hasDecisionControls ? commitDecisionsAndPause : undefined}
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

  const hasInlineWarning = Boolean(warning || (journeyStatus === 'error' && threadLastError));
  const footer = isRunning ? (
    <TextButton
      variant="danger"
      onClick={handleCancel}
      disabled={footerActionInFlight !== null}
      loading={footerActionInFlight === 'cancel'}
    >
      Cancel
    </TextButton>
  ) : canResume ? (
    <>
      <TextButton
        variant="primary"
        onClick={handleResume}
        disabled={footerActionInFlight !== null || unresolvedToolCallCount > 0}
        loading={footerActionInFlight === 'resume'}
      >
        Resume
      </TextButton>
      <TextButton
        variant="danger"
        onClick={handleCancel}
        disabled={footerActionInFlight !== null}
        loading={footerActionInFlight === 'cancel'}
      >
        Cancel
      </TextButton>
    </>
  ) : undefined;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      showHeader={false}
      size="large"
      className="journey-detail-modal"
      footer={footer}
    >
      {/* Header */}
      <div className="journey-detail-header">
        <div className="journey-detail-header-left">
          <div className="journey-detail-header-meta">
            <h3 className="journey-detail-title">{label}</h3>
            {statusText && (
              <span className={`journey-detail-status journey-detail-status--${status}`}>
                {statusText}
              </span>
            )}
          </div>
          {message ? (
            <div className="journey-detail-header-message">{message}</div>
          ) : null}
        </div>
        <div className="journey-detail-header-right">
          <IconButton icon={<Close size="md" />} onClick={onClose} title="Close" size="md" variant="ghost" />
        </div>
      </div>

      {/* Scrollable message timeline */}
      <div className="journey-detail-body" ref={bodyRef}>
        <div className="journey-detail-body__content" ref={bodyContentRef}>
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

        {showScrollButton && (
          <IconButton
            className="scroll-to-bottom-button journey-detail-scroll-button"
            icon={<ChevronDown size="sm" />}
            onClick={() => scrollToBottom()}
            title="Scroll to bottom"
            variant="secondary"
          />
        )}
      </div>
    </BaseModal>
  );
};

export default JourneyNotificationDetail;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { BaseModal } from '../BaseModal';
import { useThreadStore } from '../../store/threadStore';
import type { ThreadMessagesResponse } from '../../api/threadService';
import {
  cancelThread,
  resumeThread,
  sendThreadMessage,
} from '../../runtime/threadCommands';
import {
  canResumeThreadStatus,
} from '../../types/thread';
import type { ThreadStatus } from '../../types/thread';
import ThreadMessageList from '../ThreadConversation/ThreadMessageList';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { Close } from '../icons';
import type { NotificationStatus } from '../../store/notificationStore';
import { formatNotificationStatusLabelFor } from './notificationPresentation';
import './JourneyNotificationDetail.css';

interface JourneyNotificationDetailProps {
  threadId: string;
  label: string;
  status: NotificationStatus;
  message: string;
  projectId: string;
  onClose: () => void;
}

type LatestRunContext = {
  inputPayload: Record<string, any>;
  contextObjectIds: string[];
  journeyTargetIds: string[];
  language: string;
  runMode: 'planMode' | 'agentMode' | null;
  surface: string | null;
};

function toLatestRunContext(responseLatestRun: ThreadMessagesResponse['latestRun']): LatestRunContext | null {
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

function useMeasuredHeight<T extends HTMLElement>() {
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState(0);

  const ref = useCallback((element: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!element) {
      setHeight(0);
      return;
    }

    const apply = () => setHeight(element.offsetHeight);
    apply();

    const observer = new ResizeObserver(apply);
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  useEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  return [ref, height] as const;
}

const JourneyNotificationDetail: React.FC<JourneyNotificationDetailProps> = ({
  threadId,
  label,
  status,
  message,
  projectId,
  onClose,
}) => {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [footerActionInFlight, setFooterActionInFlight] = useState<'resume' | 'cancel' | 'feedback' | null>(null);
  const [latestRunContext, setLatestRunContext] = useState<LatestRunContext | null>(null);
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();
  const [footerRef, footerHeight] = useMeasuredHeight<HTMLDivElement>();

  const {
    storedThreadStatus,
    runtimeUnresolvedToolCallCount,
    pendingToolCallCount,
    messageCount,
  } = useThreadStore(
    useShallow((state) => ({
      storedThreadStatus: state.threadsById[threadId]?.status,
      runtimeUnresolvedToolCallCount: state.threadsById[threadId]?.unresolvedToolCallCount ?? 0,
      pendingToolCallCount: state.pendingToolCallIdsByThread[threadId]?.length ?? 0,
      messageCount: state.messagesByThreadId[threadId]?.length ?? 0,
    })),
  );

  useEffect(() => {
    setFeedbackOpen(false);
    setFeedbackText('');
    setFooterActionInFlight(null);
    setLatestRunContext(null);
  }, [threadId]);

  const handleSnapshotLoaded = useCallback((response: ThreadMessagesResponse) => {
    setLatestRunContext(toLatestRunContext(response.latestRun));
  }, []);

  const journeyStatus = (storedThreadStatus ?? status) as ThreadStatus;
  const statusText = formatNotificationStatusLabelFor('journey', journeyStatus as NotificationStatus);
  const isRunning = journeyStatus === 'running' || journeyStatus === 'processing';
  const isWaiting = journeyStatus === 'waiting';
  const canResume = canResumeThreadStatus(journeyStatus);
  const unresolvedToolCallCount = runtimeUnresolvedToolCallCount > 0
    ? runtimeUnresolvedToolCallCount
    : pendingToolCallCount;
  const hasDecisionControls = unresolvedToolCallCount > 0;
  const isFeedbackDisabled = isRunning || isWaiting || hasDecisionControls || latestRunContext === null;
  const headerMessage = journeyStatus === 'error' ? '' : message;
  const showFeedback = !isRunning && messageCount > 0;

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

  const handleSendFeedback = useCallback(() => {
    if (!feedbackText.trim() || latestRunContext === null || footerActionInFlight) return;
    setFooterActionInFlight('feedback');
    const op = sendThreadMessage({
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
    void op.finally(() => setFooterActionInFlight(null));
    setFeedbackText('');
    setFeedbackOpen(false);
  }, [feedbackText, footerActionInFlight, latestRunContext, projectId, threadId]);

  const handleFeedbackKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendFeedback();
      }
    },
    [handleSendFeedback],
  );

  const footerActions = useMemo(() => {
    if (isRunning) {
      return (
        <TextButton
          variant="danger"
          onClick={handleCancel}
          disabled={footerActionInFlight !== null}
          loading={footerActionInFlight === 'cancel'}
        >
          Cancel
        </TextButton>
      );
    }
    if (!canResume) return null;
    return (
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
    );
  }, [
    canResume,
    footerActionInFlight,
    handleCancel,
    handleResume,
    isRunning,
    unresolvedToolCallCount,
  ]);

  const showFooterOverlay = Boolean(footerActions) || showFeedback;

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      showHeader={false}
      size="large"
      className="journey-detail-modal"
    >
      <div className="journey-detail-pane">
        <ThreadMessageList
          threadId={threadId}
          projectId={projectId}
          roleLabels={{ user: 'You', assistant: 'AI' }}
          emptyState="No messages yet."
          onSnapshotLoaded={handleSnapshotLoaded}
          topOverlayHeight={headerHeight}
          bottomOverlayHeight={showFooterOverlay ? footerHeight : 0}
        />

        <div className="journey-detail-floating-header" ref={headerRef}>
          <div className="journey-detail-header-left">
            <div className="journey-detail-header-meta">
              <h3 className="journey-detail-title">{label}</h3>
              {statusText && (
                <span className={`journey-detail-status journey-detail-status--${journeyStatus}`}>
                  {statusText}
                </span>
              )}
            </div>
            {headerMessage ? (
              <div className="journey-detail-header-message">{headerMessage}</div>
            ) : null}
          </div>
          <div className="journey-detail-header-right">
            <IconButton icon={<Close size="md" />} onClick={onClose} title="Close" size="md" variant="ghost" />
          </div>
        </div>

        {showFooterOverlay && (
          <div className="journey-detail-floating-footer" ref={footerRef}>
            {footerActions && (
              <div className="journey-detail-footer-actions">
                {footerActions}
              </div>
            )}

            {showFeedback && (
              <div className={`journey-detail-feedback ${feedbackOpen ? 'journey-detail-feedback--open' : ''}`}>
                <button
                  type="button"
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
                            loading={footerActionInFlight === 'feedback'}
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
        )}
      </div>
    </BaseModal>
  );
};

export default JourneyNotificationDetail;

/**
 * LLM Task Modals
 * Renders modals based on llmTaskStore modal state
 */

import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { BaseModal } from '../components/BaseModal';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { useSettingsStore } from '../store/settingsStore';
import ThinkingDisplay from '../components/ThinkingDisplay';
import NotificationProgressBar from '../components/Notification/NotificationProgressBar';
import { Close } from '../components/icons';
import { TextButton } from '../components/TextButton';
import { IconButton } from '../components/IconButton';
import { FunctionCallCard } from '../components/functionCall';
import { TaskRuntime, type TaskSessionState } from '.';
import { applySessionEdits, rejectAllSessionEdits } from './functionCalls/functionCallEngine';
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
  const isPending = session?.status === 'pending_confirmation' || isApplying;

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
    await applySessionEdits({
      sessionId: session.id,
      projectId,
      language: applyLanguage,
      selections,
      options: handlerOptions,
    });
  }, [projectId, session?.id, applyLanguage, handlerOptions]);

  const handleRejectAll = useCallback(() => {
    if (!session) return;
    rejectAllSessionEdits({ sessionId: session.id });
  }, [session?.id]);

  if (!session) return null;

  const footer = (
    <div className="notification-detail-footer-actions">
      <TextButton variant="secondary" onClick={handleDismissToast}>
        Dismiss
      </TextButton>
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
      onClose={closeDetail}
      showHeader={false}
      className="notification-detail-modal"
      size="large"
      footer={<div className="notification-detail-footer">{footer}</div>}
    >
      <div className="notification-detail-header">
        <div className="notification-detail-title">
          <h3>{session.label}</h3>
          <span className={`notification-detail-status notification-detail-status--${session.status}`}>
            {statusLabel}
          </span>

          {session.status === 'error' && session.error && (
            <div
              className={`notification-detail-error-container ${errorExpanded ? 'notification-detail-error-container--expanded' : ''}`}
              onClick={() => setErrorExpanded(prev => !prev)}
            >
              <div className="notification-detail-error-summary-text">{session.error}</div>
            </div>
          )}

          {session.warning && (
            <div className="notification-detail-warning-container">
              <div className="notification-detail-warning-text">{session.warning}</div>
            </div>
          )}
        </div>

        <IconButton
          icon={<Close size="sm" />}
          onClick={closeDetail}
          title="Close"
          size="sm"
          className="notification-detail-close"
        />
      </div>

      {session.status === 'running' && session.progress && (
        <div className="notification-detail-progress">
          <div className="notification-detail-progress-text">
            {session.progress.currentItemLabel || `${session.progress.current}/${session.progress.total}`}
          </div>
          <NotificationProgressBar current={session.progress.current} total={session.progress.total} />
        </div>
      )}

      {userInput.trim() && (
        <div className="notification-detail-user-input">
          <div className="notification-detail-user-input-label">Input</div>
          <div className="notification-detail-user-input-content">{userInput}</div>
        </div>
      )}

      <div className="notification-detail-body">
        {session.contentParts.length > 0 && (
          <div className="notification-detail-thinking">
            <ThinkingDisplay
              messageId={session.id}
              contentParts={session.contentParts}
              isStreaming={session.status === 'running'}
            />
          </div>
        )}

        <div className="notification-detail-stream">
          <button
            className="notification-detail-stream-toggle"
            onClick={() => setOutputExpanded(prev => !prev)}
          >
            <span className="toggle-icon">{outputExpanded ? '-' : '+'}</span>
            <span className="notification-detail-stream-label">Output</span>
          </button>
          {outputExpanded && (
            <div className="notification-detail-stream-content">
              {contentText || <span className="notification-detail-waiting">Waiting...</span>}
            </div>
          )}
        </div>

        {hasStreamingCalls && (
          <div className="notification-detail-function-calls">
            <FunctionCallCard
              mode="streaming"
              streamingProgress={session.functionCallProgress}
              projectId={projectId}
            />
          </div>
        )}

        {hasCards && (
          <div className="notification-detail-function-calls">
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

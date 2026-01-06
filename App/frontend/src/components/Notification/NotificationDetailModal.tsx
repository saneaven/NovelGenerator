import React, { useMemo, useCallback } from 'react';
import { BaseModal } from '../BaseModal';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import { useSettingsStore } from '../../store/settingsStore';
import ThinkingDisplay from '../ThinkingDisplay';
import NotificationProgressBar from './NotificationProgressBar';
import { Close } from '../icons';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { FunctionCallCard } from '../functionCall';
import { TaskRuntime, type TaskSessionState } from '../../llmTask';
import { applySessionEdits, rejectAllSessionEdits } from '../../llmTask/functionCalls/functionCallEngine';
import type { HandlerOptions } from '../../functionCall/applicator/types';
import { CRUD_OPTIONS, TRANSLATION_OPTIONS } from '../../functionCall/applicator/types';
import './NotificationDetailModal.css';

interface NotificationDetailModalProps {
  session: TaskSessionState;
  onClose: () => void;
  onDismissToast: () => void;
}

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

const NotificationDetailModal: React.FC<NotificationDetailModalProps> = ({
  session,
  onClose,
  onDismissToast,
}) => {
  const mainLanguage = useSettingsStore(state => state.settings.mainLanguage);
  const cancelTask = useLLMTaskStore(state => state.cancelTask);

  const statusLabel = useMemo(() => {
    switch (session.status) {
      case 'pending_confirmation':
        return 'Needs confirmation';
      case 'applying':
        return 'Applying...';
      default:
        return session.status;
    }
  }, [session.status]);

  const userInput = useMemo(() => {
    if (session.kind === 'aiEdit') return ((session.input as any)?.userRequest as string | undefined) ?? '';
    if (session.kind === 'translateObjects') return ((session.input as any)?.userInput as string | undefined) ?? '';
    if (session.kind === 'agent') return ((session.input as any)?.userInput as string | undefined) ?? '';
    return '';
  }, [session.kind, session.input]);

  const contentText = useMemo(() => {
    return session.contentParts
      .filter(p => p.type === 'content')
      .map(p => p.text)
      .join('');
  }, [session.contentParts]);

  const hasStreamingCalls = session.status === 'running' && (session.functionCallProgress?.length ?? 0) > 0;
  const hasCards = (session.editCards?.length ?? 0) > 0;
  const isApplying = session.status === 'applying';
  const isPending = session.status === 'pending_confirmation' || isApplying;

  const projectId = ((session.input as any)?.projectId as string | undefined) ?? '';
  const applyLanguage = useMemo(() => getApplyLanguage(session, mainLanguage), [session, mainLanguage]);
  const handlerOptions = useMemo(() => getHandlerOptions(session), [session]);

  const handleRetry = useCallback(() => {
    TaskRuntime.retry(session.id);
    onClose();
  }, [session.id, onClose]);

  const handleCancel = useCallback(() => {
    cancelTask(session.id);
  }, [cancelTask, session.id]);

  const handleConfirm = useCallback(async (selections: Record<string, boolean>) => {
    if (!projectId) return;
    await applySessionEdits({
      sessionId: session.id,
      projectId,
      language: applyLanguage,
      selections,
      options: handlerOptions,
    });
  }, [projectId, session.id, applyLanguage, handlerOptions]);

  const handleRejectAll = useCallback(() => {
    rejectAllSessionEdits({ sessionId: session.id });
  }, [session.id]);

  const footer = (
    <div className="notification-detail-footer-actions">
      <TextButton variant="secondary" onClick={onDismissToast}>
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
      onClose={onClose}
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
            <div className="notification-detail-error-container">
              <div className="notification-detail-error-summary-text">{session.error}</div>
            </div>
          )}
        </div>

        <IconButton
          icon={<Close size="sm" />}
          onClick={onClose}
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

      {hasStreamingCalls && (
        <div className="notification-detail-pending-confirmation">
          <FunctionCallCard
            mode="streaming"
            streamingProgress={session.functionCallProgress}
            projectId={projectId}
          />
        </div>
      )}

      {hasCards && (
        <div className="notification-detail-pending-confirmation">
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

      <div className="notification-detail-body">
        {session.contentParts.length > 0 ? (
          <>
            <div className="notification-detail-thinking">
              <ThinkingDisplay
                messageId={session.id}
                contentParts={session.contentParts}
                isStreaming={session.status === 'running'}
              />
            </div>

            <div className="notification-detail-stream">
              <div className="notification-detail-stream-label">Output</div>
              <div className="notification-detail-stream-content">
                {contentText || <span className="notification-detail-waiting">Waiting...</span>}
              </div>
            </div>
          </>
        ) : (
          <div className="notification-detail-no-content">No output yet.</div>
        )}
      </div>
    </BaseModal>
  );
};

export default NotificationDetailModal;


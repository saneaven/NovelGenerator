import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import type { ThreadMessagesResponse } from '../../api/threadService';
import { threadService } from '../../api/threadService';
import { applyThreadSnapshot } from '../../runtime/threadHydration';
import { useThreadStore } from '../../store/threadStore';
import { useSettings } from '../../store/settingsStore';
import type { ThreadMessage, ThreadStatus } from '../../types/thread';
import { isPausedLikeThreadStatus } from '../../types/thread';
import { useThreadLiveViewState } from '../../hooks/useThreadLiveViewState';
import { useAutoScrollLock } from '../../hooks/useAutoScrollLock';
import { buildEditCardsFromToolCallMetadata } from '../../toolCall';
import { FunctionCallsThread } from '../../toolCall/ui';
import { useToolCallDecisions } from '../../toolCall/useToolCallDecisions';
import { IconButton } from '../IconButton';
import { ChevronDown } from '../icons';
import { Loading } from '../common/Loading';
import ThinkingDisplay from '../common/ThinkingDisplay';
import PreexistingLiveRunNotice from '../common/PreexistingLiveRunNotice';
import MessageAttachmentBlock from './MessageAttachmentBlock';
import MessageMcpChipRow from './MessageMcpChipRow';
import MessageRowToolbar from './MessageRowToolbar';
import { useThreadMessageRows } from './useThreadMessageRow';
import './ThreadMessageList.css';

const SubAgentPeekDock = React.lazy(() => import('../SubAgentPeek/SubAgentPeekDock'));

const EMPTY_MESSAGES: ThreadMessage[] = [];

const STAGE_KEY_BY_STAGE: Record<string, string> = {
  retrieving_memory: 'agent.stage.retrievingMemory',
  rendering_prompt: 'agent.stage.renderingPrompt',
  summarizing_context: 'agent.stage.summarizingContext',
  retrying: 'agent.stage.retrying',
};

interface ThreadMessageListProps {
  threadId: string;
  projectId: string;
  roleLabels?: { user?: string; assistant?: string };
  emptyState?: React.ReactNode;
  className?: string;
  onSnapshotLoaded?: (response: ThreadMessagesResponse) => void;
  topOverlayHeight?: number;
  bottomOverlayHeight?: number;
}

function isPendingToolCallStatus(status: string | undefined): boolean {
  return status === 'pending'
    || status === 'streaming'
    || status === 'validating'
    || status === 'processing'
    || status === 'working';
}

function isLiveStatus(status: ThreadStatus | undefined): boolean {
  return status === 'running' || status === 'processing';
}

function TypingIndicator({ inline = false }: { inline?: boolean }) {
  return (
    <div className={`thread-message-typing${inline ? ' thread-message-typing--inline' : ''}`}>
      <div className="thread-message-typing__track">
        <div className="thread-message-typing__bar" />
      </div>
    </div>
  );
}

const ThreadMessageList: React.FC<ThreadMessageListProps> = ({
  threadId,
  projectId,
  roleLabels,
  emptyState,
  className,
  onSnapshotLoaded,
  topOverlayHeight = 0,
  bottomOverlayHeight = 0,
}) => {
  const { t } = useTranslation();
  const settings = useSettings();
  const sourceLanguage = settings.mainLanguage;
  const secondaryLanguage = settings.defaultSubLanguage ?? undefined;
  const [hydrating, setHydrating] = useState(false);
  const [hydrateError, setHydrateError] = useState<string | null>(null);
  const [messageLanguageView, setMessageLanguageView] = useState<Record<string, 'primary' | 'secondary' | undefined>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);

  const {
    thread,
    messages,
    toolCallsById,
    toolCallIdsByAssistantMessageId,
    currentStage,
  } = useThreadStore(
    useShallow((state) => ({
      thread: threadId ? state.threadsById[threadId] : undefined,
      messages: threadId ? state.messagesByThreadId[threadId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
      toolCallsById: state.toolCallsById,
      toolCallIdsByAssistantMessageId: state.toolCallIdsByAssistantMessageId,
      currentStage: threadId ? state.currentStageByThread[threadId] ?? null : null,
    })),
  );

  const liveView = useThreadLiveViewState(threadId);
  const isMessageRunActive = isLiveStatus(thread?.status) || liveView?.noticeKind === 'preexisting_live_run';

  const {
    rows,
    editingMessageId,
    translatingByMessageId,
    startEdit,
    translateMessage,
    deleteMessage,
    editModal,
    toToolCallMetadata,
  } = useThreadMessageRows({
    threadId,
    projectId,
    messages,
    toolCallsById,
    toolCallIdsByAssistantMessageId,
    sourceLanguage,
    secondaryLanguage,
    messageLanguageView,
  });

  const {
    showScrollButton,
    scrollToBottom,
    resetToBottom,
  } = useAutoScrollLock({
    scrollContainerRef,
    contentRef: scrollContentRef,
    active: isMessageRunActive,
  });

  const { commitDecisions, commitDecisionsAndPause } = useToolCallDecisions(threadId || null);

  useEffect(() => {
    setMessageLanguageView({});
  }, [threadId, secondaryLanguage]);

  useEffect(() => {
    if (!threadId) return;
    const existingMessages = useThreadStore.getState().getMessages(threadId);
    if (existingMessages.length > 0) return;

    let cancelled = false;
    setHydrating(true);
    setHydrateError(null);

    void threadService.listMessages(threadId)
      .then((response) => {
        if (cancelled) return;
        applyThreadSnapshot(response);
        onSnapshotLoaded?.(response);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('Failed to hydrate thread messages', { threadId, error });
        setHydrateError(error instanceof Error ? error.message : 'Failed to load messages.');
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [onSnapshotLoaded, threadId]);

  useEffect(() => {
    resetToBottom();
  }, [resetToBottom, threadId]);

  const latestUserMessageId = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === 'user') return rows[i].message.id;
    }
    return null;
  }, [rows]);

  const latestAssistantMessageId = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === 'assistant') return rows[i].message.id;
    }
    return null;
  }, [rows]);

  const stageTranslationKey = currentStage ? STAGE_KEY_BY_STAGE[currentStage] : null;
  const showStage = Boolean(stageTranslationKey) && isMessageRunActive && thread?.status === 'running';

  const style = {
    '--thread-message-list-top-overlay': `${topOverlayHeight}px`,
    '--thread-message-list-bottom-overlay': `${bottomOverlayHeight}px`,
  } as React.CSSProperties;

  const threadStatus = thread?.status ?? 'done';
  const runError = threadStatus === 'error'
    ? (thread?.lastError || 'An error occurred during generation.')
    : null;
  const rootClassName = [
    'thread-message-list',
    className ?? '',
  ].filter(Boolean).join(' ');

  return (
    <div className={rootClassName} style={style}>
      <div className="thread-message-list__scroll" ref={scrollContainerRef}>
        <div className="thread-message-list__content" ref={scrollContentRef}>
          {hydrating && rows.length === 0 && (
            <div className="thread-message-list__loading">
              <Loading size="md" />
              <span>Loading messages...</span>
            </div>
          )}

          {hydrateError && rows.length === 0 && (
            <div className="thread-message-list__error" role="alert">
              {hydrateError}
            </div>
          )}

          {!hydrating && !hydrateError && rows.length === 0 && !isMessageRunActive && (
            <div className="thread-message-list__empty">
              {emptyState ?? 'No messages yet.'}
            </div>
          )}

          {rows.map((row) => {
            const isUser = row.role === 'user';
            const isAssistant = row.role === 'assistant';
            const roleLabel = isUser
              ? (roleLabels?.user ?? t('agent.you'))
              : (roleLabels?.assistant ?? t('agent.ai'));
            const isStickyLatestUser = isUser && row.message.id === latestUserMessageId;
            const hasBody = row.bodyText.length > 0 || row.isStreaming;
            const isEditing = editingMessageId === row.message.id;
            const isAnyMessageEditing = Boolean(editingMessageId);
            const translating = Boolean(translatingByMessageId[row.message.id]);
            const canEdit = !row.isStreaming && !row.isSecondaryView && !isAnyMessageEditing;
            const canTranslate = !row.isStreaming && !row.isSecondaryView && !isAnyMessageEditing;
            const canToggleLanguage = !row.isStreaming
              && !isAnyMessageEditing
              && row.translationAvailable
              && Boolean(secondaryLanguage);
            const canDelete = !isEditing;
            const cards = isAssistant && row.toolCalls.length > 0
              ? buildEditCardsFromToolCallMetadata(row.toolCalls.map(toToolCallMetadata))
              : [];
            const isLatestAssistant = row.message.id === latestAssistantMessageId;
            const isPendingDecisionState = isLatestAssistant && (
              threadStatus === 'waiting' || isPausedLikeThreadStatus(threadStatus)
            );
            const allowApplyAndPause = isLatestAssistant && threadStatus === 'waiting';
            const hasPendingCards = cards.some((card) => isPendingToolCallStatus(card.toolCall.status));
            const hasSubAgentCalls = row.toolCalls.some((toolCall) => (
              toolCall.toolName.startsWith('call_') && Boolean(toolCall.childThreadId)
            ));

            const messageHeader = (
              <div className="thread-message-row__header">
                <span className="thread-message-row__role">{roleLabel}</span>
                <MessageRowToolbar
                  canEdit={canEdit}
                  canTranslate={canTranslate}
                  canToggleLanguage={canToggleLanguage}
                  canDelete={canDelete}
                  editDisabled={!row.primaryText}
                  translateDisabled={!secondaryLanguage || translating || !row.primaryText}
                  deleteDisabled={false}
                  languageToggleActive={row.isSecondaryView}
                  isTranslating={translating}
                  translationAvailable={row.translationAvailable}
                  sourceLanguage={sourceLanguage}
                  targetLanguage={secondaryLanguage}
                  onEdit={() => startEdit(row.message.id, row.primaryText)}
                  onTranslate={() => void translateMessage(row.message, row.primaryText)}
                  onToggleLanguage={() => setMessageLanguageView((prev) => ({
                    ...prev,
                    [row.message.id]: row.isSecondaryView ? 'primary' : 'secondary',
                  }))}
                  onDelete={() => void deleteMessage(row.message, row.toolCalls.length)}
                />
              </div>
            );

            const thinkingBlock = isAssistant ? (
              <ThinkingDisplay
                messageId={row.message.id}
                reasoningDetail={row.chatMessage.reasoning_detail as any}
                isStreaming={row.isStreaming}
              />
            ) : null;

            const attachmentBlock = row.message.attachments.length > 0 ? (
              <MessageAttachmentBlock attachments={row.message.attachments} />
            ) : null;

            const mcpBlock = row.mcpSelections.length > 0 ? (
              <MessageMcpChipRow selections={row.mcpSelections} />
            ) : null;

            const contentBlock = hasBody ? (
              <div className="thread-message-row__content">
                {row.displayContent}
                {row.isStreaming && thread?.status === 'running' && (
                  <TypingIndicator inline />
                )}
              </div>
            ) : null;

            const toolCallsBlock = cards.length > 0 ? (
              <div className="thread-message-row__tool-calls">
                {row.toolCallMessageIds.map((messageId) => (
                  <span
                    key={messageId}
                    className="thread-message-row__tool-call-anchor"
                    data-function-call-message-id={messageId}
                  />
                ))}
                <FunctionCallsThread
                  threadId={threadId}
                  scopeKey={`thread:${threadId}:assistant:${row.message.id}`}
                  mode={isPendingDecisionState && hasPendingCards ? 'pending' : 'confirmed'}
                  cards={cards}
                  onCommitDecisions={
                    isPendingDecisionState && hasPendingCards
                      ? commitDecisions
                      : undefined
                  }
                  onCommitDecisionsAndPause={
                    allowApplyAndPause && hasPendingCards
                      ? commitDecisionsAndPause
                      : undefined
                  }
                  projectId={projectId}
                />
              </div>
            ) : null;

            const subAgentBlock = threadId && hasSubAgentCalls ? (
              <Suspense fallback={null}>
                <SubAgentPeekDock
                  parentThreadId={threadId}
                  parentMessageId={row.message.id}
                  projectId={projectId}
                  isActiveParent={row.message.id === latestAssistantMessageId}
                />
              </Suspense>
            ) : null;

            const memoryBoundaryBlock = thread?.memoryBoundaryMessageId === row.message.id ? (
              <div className="thread-memory-boundary" role="separator" aria-label="Memory boundary">
                <div className="thread-memory-boundary__line" />
                <span className="thread-memory-boundary__label">Memory boundary</span>
                <div className="thread-memory-boundary__line" />
              </div>
            ) : null;

            const bodyBlock = thinkingBlock || contentBlock || toolCallsBlock || subAgentBlock;
            const bodyRowClassName = [
              'thread-message-row',
              `thread-message-row--${row.role}`,
              'thread-message-row--body',
              isStickyLatestUser && contentBlock ? 'thread-message-row--sticky-latest-user' : '',
            ].filter(Boolean).join(' ');

            return (
              <div
                key={row.message.id}
                className={`thread-message-row-group thread-message-row-group--${row.role}`}
              >
                <article className={`thread-message-row thread-message-row--${row.role} thread-message-row--meta`}>
                  <div className="thread-message-row__shell">
                    {messageHeader}
                    {attachmentBlock}
                    {mcpBlock}
                  </div>
                </article>

                {bodyBlock && (
                  <article className={bodyRowClassName}>
                    <div className="thread-message-row__shell">
                      {thinkingBlock}
                      {contentBlock}
                      {toolCallsBlock}
                      {subAgentBlock}
                    </div>
                  </article>
                )}

                {memoryBoundaryBlock}
              </div>
            );
          })}

          {runError && (
            <div className="thread-message-list__run-error" role="alert">
              <span className="thread-message-list__run-error-mark" aria-hidden="true">!</span>
              <span>{runError}</span>
            </div>
          )}

          {isMessageRunActive && !liveView?.hasStreamingMessage && liveView?.noticeKind === 'preexisting_live_run' && (
            <PreexistingLiveRunNotice className="thread-message-list__live-notice" />
          )}

          {showStage && stageTranslationKey && (
            <div className="thread-message-list__stage">
              {t(stageTranslationKey)}...
            </div>
          )}

          {isMessageRunActive
            && !liveView?.hasStreamingMessage
            && liveView?.noticeKind !== 'preexisting_live_run'
            && isLiveStatus(thread?.status) && (
            <TypingIndicator />
          )}
        </div>
      </div>

      {showScrollButton && (
        <IconButton
          className="thread-message-list__scroll-button"
          icon={<ChevronDown size="sm" />}
          onClick={() => scrollToBottom()}
          title={t('agent.scrollToBottom')}
          variant="secondary"
        />
      )}

      {editModal}
    </div>
  );
};

export type { ThreadMessageListProps };
export default ThreadMessageList;

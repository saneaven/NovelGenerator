import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useThreadStore } from '../../store/threadStore';
import type { ThreadInfo, ThreadToolCall } from '../../types/thread';
import {
  canPauseThreadStatus,
  canResumeThreadStatus,
  isBlockingThreadStatus,
} from '../../types/thread';
import { useFunctionCallUIStore } from '../../toolCall/ui/store';
import { useThreadLiveViewState } from '../../hooks/useThreadLiveViewState';
import { useAutoScrollLock } from '../../hooks/useAutoScrollLock';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { ChevronDown } from '../icons';
import { SubAgentPeekHeader } from './SubAgentPeekHeader';
import { SubAgentPeekTimeline } from './SubAgentPeekTimeline';
import { cancelThread, pauseThread, resumeThread } from '../../runtime/threadCommands';
import './subAgentPeek.css';

interface ChildEntry {
  key: string;
  childThreadId: string;
  displayName: string;
  thread: ThreadInfo;
  callSeq: number;
}

function countPendingDecisions(
  childThreadId: string,
  messagesByThreadId: Record<string, any[] | undefined>,
  toolCallsByMessageId: Record<string, any[] | undefined>,
): number {
  const messages = messagesByThreadId[childThreadId] ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    const toolCalls = toolCallsByMessageId[message.id] ?? [];
    return toolCalls.filter((tc: any) => (
      tc?.status === 'pending'
      || tc?.status === 'streaming'
      || tc?.status === 'validating'
      || tc?.status === 'processing'
      || tc?.status === 'working'
    )).length;
  }
  return 0;
}

function threadStatusToDisplay(status: ThreadInfo['status']): string {
  if (status === 'done') return 'completed';
  return status;
}

export interface SubAgentPeekDockProps {
  parentThreadId: string;
  parentMessageId: string;
  projectId: string;
  isActiveParent: boolean;
}

export const SubAgentPeekDock: React.FC<SubAgentPeekDockProps> = ({
  parentThreadId,
  parentMessageId,
  projectId,
  isActiveParent,
}) => {
  const peekKey = `${parentThreadId}:${parentMessageId}:peek`;

  const {
    threadsById,
    messagesByThreadId,
    toolCallsById,
    toolCallIdsByAssistantMessageId,
    toolCallsByMessageId,
    pendingToolCallIdsByThread,
  } = useThreadStore(
    useShallow((state) => ({
      threadsById: state.threadsById,
      messagesByThreadId: state.messagesByThreadId,
      toolCallsById: state.toolCallsById,
      toolCallIdsByAssistantMessageId: state.toolCallIdsByAssistantMessageId,
      toolCallsByMessageId: state.toolCallsByMessageId,
      pendingToolCallIdsByThread: state.pendingToolCallIdsByThread,
    })),
  );

  const setPeekOpen = useFunctionCallUIStore((state) => state.setPeekOpen);
  const setSelectedPeekRun = useFunctionCallUIStore((state) => state.setSelectedPeekRun);

  const peekOpen = useFunctionCallUIStore(
    (state) => state.peekOpenByThread[peekKey] ?? isActiveParent,
  );
  const selectedKey = useFunctionCallUIStore(
    (state) => state.selectedPeekRunByThread[peekKey],
  );
  const pendingSnapshotRef = useRef<Record<string, string[]>>({});
  const pendingSnapshotInitializedRef = useRef(false);

  const childEntries = useMemo(() => {
    // parentMessageId is the assistant message ID — look up via the assistant message index
    const tcIds = toolCallIdsByAssistantMessageId[parentMessageId] ?? [];
    const parentToolCalls: ThreadToolCall[] = tcIds
      .map((id) => toolCallsById[id])
      .filter((tc): tc is ThreadToolCall => Boolean(tc));
    const result: ChildEntry[] = [];

    for (const tc of parentToolCalls) {
      if (!tc.toolName.startsWith('call_') || !tc.childThreadId) continue;
      const thread = threadsById[tc.childThreadId];
      if (!thread) continue;
      result.push({
        key: tc.childThreadId,
        childThreadId: tc.childThreadId,
        displayName: tc.toolName.slice(5),
        thread,
        callSeq: tc.callSeq,
      });
    }

    result.sort((a, b) => a.callSeq - b.callSeq);
    return result;
  }, [toolCallIdsByAssistantMessageId, toolCallsById, parentMessageId, threadsById]);

  const pendingCountByKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of childEntries) {
      map[entry.key] = countPendingDecisions(
        entry.childThreadId,
        messagesByThreadId,
        toolCallsByMessageId,
      );
    }
    return map;
  }, [childEntries, messagesByThreadId, toolCallsByMessageId]);

  const orderedKeys = useMemo(() => childEntries.map((e) => e.key), [childEntries]);

  const entryByKey = useMemo(() => {
    const map: Record<string, ChildEntry | undefined> = {};
    for (const entry of childEntries) {
      map[entry.key] = entry;
    }
    return map;
  }, [childEntries]);

  const pendingToolCallIdsByKey = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const entry of childEntries) {
      map[entry.key] = [...(pendingToolCallIdsByThread[entry.childThreadId] ?? [])].sort();
    }
    return map;
  }, [childEntries, pendingToolCallIdsByThread]);

  useEffect(() => {
    if (orderedKeys.length === 0) return;
    if (!selectedKey || !orderedKeys.includes(selectedKey)) {
      setSelectedPeekRun(peekKey, orderedKeys[0]);
    }
  }, [
    orderedKeys,
    selectedKey,
    setSelectedPeekRun,
    peekKey,
  ]);

  useEffect(() => {
    pendingSnapshotRef.current = {};
    pendingSnapshotInitializedRef.current = false;
  }, [peekKey]);

  useEffect(() => {
    if (orderedKeys.length === 0) {
      pendingSnapshotRef.current = {};
      pendingSnapshotInitializedRef.current = false;
      return;
    }

    const currentSnapshot: Record<string, string[]> = {};
    for (const key of orderedKeys) {
      currentSnapshot[key] = pendingToolCallIdsByKey[key] ?? [];
    }

    if (!pendingSnapshotInitializedRef.current) {
      pendingSnapshotRef.current = currentSnapshot;
      pendingSnapshotInitializedRef.current = true;
      return;
    }

    let nextSelectedKey: string | undefined;
    const previousSnapshot = pendingSnapshotRef.current;

    for (const key of orderedKeys) {
      if (!(key in previousSnapshot)) continue;
      const previousIds = new Set(previousSnapshot[key] ?? []);
      const currentIds = currentSnapshot[key] ?? [];
      if (currentIds.some((id) => !previousIds.has(id))) {
        nextSelectedKey = key;
        break;
      }
    }

    pendingSnapshotRef.current = currentSnapshot;
    if (nextSelectedKey && nextSelectedKey !== selectedKey) {
      setSelectedPeekRun(peekKey, nextSelectedKey);
    }
  }, [orderedKeys, pendingToolCallIdsByKey, peekKey, selectedKey, setSelectedPeekRun]);

  const selectedEntry = useMemo(() => {
    if (orderedKeys.length === 0) return undefined;
    const effective = selectedKey && orderedKeys.includes(selectedKey)
      ? selectedKey
      : orderedKeys[0];
    return entryByKey[effective];
  }, [entryByKey, orderedKeys, selectedKey]);

  const { t } = useTranslation();
  const [actionInFlight, setActionInFlight] = useState<'pause' | 'resume' | 'cancel' | null>(null);

  const selectedChildThreadId = selectedEntry?.childThreadId;
  const selectedLiveView = useThreadLiveViewState(selectedChildThreadId);
  const peekBodyRef = useRef<HTMLDivElement | null>(null);
  const peekContentRef = useRef<HTMLDivElement | null>(null);

  // Reset action state when switching threads
  useEffect(() => {
    setActionInFlight(null);
  }, [selectedChildThreadId]);

  const selectedThreadStatus = selectedEntry?.thread.status ?? 'done';
  const selectedPendingCount = selectedEntry ? (pendingCountByKey[selectedEntry.key] ?? 0) : 0;
  const runtimeUnresolvedToolCallCount = selectedEntry?.thread.unresolvedToolCallCount ?? 0;
  const selectedUnresolvedCount = runtimeUnresolvedToolCallCount > 0
    ? runtimeUnresolvedToolCallCount
    : selectedPendingCount;
  const isBlocking = isBlockingThreadStatus(selectedThreadStatus);
  const isPeekLive = selectedThreadStatus === 'running'
    || selectedLiveView?.noticeKind === 'preexisting_live_run';
  const canPauseSelectedThread = canPauseThreadStatus(selectedThreadStatus);
  const canResumeSelectedThread = canResumeThreadStatus(selectedThreadStatus);

  const {
    showScrollButton,
    scrollToBottom,
    resetToBottom,
  } = useAutoScrollLock({
    scrollContainerRef: peekBodyRef,
    contentRef: peekContentRef,
    active: isPeekLive,
  });

  useEffect(() => {
    if (!peekOpen) return;
    resetToBottom();
  }, [peekOpen, selectedChildThreadId, resetToBottom]);

  const handlePause = useCallback(() => {
    if (actionInFlight || !selectedChildThreadId) return;
    setActionInFlight('pause');
    const op = pauseThread({ threadId: selectedChildThreadId });
    void op.finally(() => setActionInFlight(null));
  }, [actionInFlight, selectedChildThreadId]);

  const handleResume = useCallback(() => {
    if (actionInFlight || !selectedChildThreadId) return;
    setActionInFlight('resume');
    const op = resumeThread({
      threadId: selectedChildThreadId,
      projectId,
      threadType: 'subAgent',
    });
    void op.finally(() => setActionInFlight(null));
  }, [actionInFlight, selectedChildThreadId, projectId]);

  const handleCancel = useCallback(() => {
    if (actionInFlight || !selectedChildThreadId) return;
    setActionInFlight('cancel');
    const op = cancelThread({ threadId: selectedChildThreadId });
    void op.finally(() => setActionInFlight(null));
  }, [actionInFlight, selectedChildThreadId]);

  if (childEntries.length === 0 || !selectedEntry) return null;

  const items = childEntries.map((entry) => ({
    key: entry.key,
    displayName: entry.displayName,
    status: threadStatusToDisplay(entry.thread.status),
    pendingCount: pendingCountByKey[entry.key] ?? 0,
    selected: selectedEntry.key === entry.key,
  }));

  const showFooter = peekOpen && isBlocking;

  return (
    <div className="sub-agent-peek-dock">
      <SubAgentPeekHeader
        open={peekOpen}
        onToggle={() => setPeekOpen(peekKey, !peekOpen)}
        items={items}
        onSelect={(key) => setSelectedPeekRun(peekKey, key)}
      />

      <div className={`sub-agent-peek-dock__body${peekOpen ? ' sub-agent-peek-dock__body--open' : ''}`}>
        <div className="sub-agent-peek-dock__body-inner" ref={peekBodyRef}>
          <div className="sub-agent-peek-dock__body-content" ref={peekContentRef}>
            <SubAgentPeekTimeline
              childThreadId={selectedEntry.childThreadId}
              projectId={projectId}
            />
          </div>
          {showScrollButton && (
            <IconButton
              className="scroll-to-bottom-button sub-agent-peek-scroll-button"
              icon={<ChevronDown size="sm" />}
              onClick={() => scrollToBottom()}
              title={t('agent.scrollToBottom')}
              variant="primary"
            />
          )}
        </div>
      </div>

      {showFooter && (
        <div className="sub-agent-peek-dock__footer">
          {canPauseSelectedThread && (
            <TextButton
              size="sm"
              variant="secondary"
              onClick={handlePause}
              disabled={actionInFlight !== null}
              loading={actionInFlight === 'pause'}
            >
              {t('subAgent.pause')}
            </TextButton>
          )}
          {canResumeSelectedThread && (
            <>
              <TextButton
                size="sm"
                variant="primary"
                onClick={handleResume}
                disabled={actionInFlight !== null || selectedUnresolvedCount > 0}
                loading={actionInFlight === 'resume'}
              >
                {t('common.resume')}
              </TextButton>
              <TextButton
                size="sm"
                variant="warning"
                onClick={handleCancel}
                disabled={actionInFlight !== null}
                loading={actionInFlight === 'cancel'}
              >
                {t('common.cancel')}
              </TextButton>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SubAgentPeekDock;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { useSubAgentStore } from '../../store/subAgentStore';
import { useThreadStore } from '../../store/threadStore';
import type { ThreadInfo, ThreadToolCall } from '../../types/thread';
import {
  canPauseThreadStatus,
  canResumeThreadStatus,
  isBlockingThreadStatus,
} from '../../types/thread';
import { useFunctionCallUIStore } from '../../toolCall/ui/store';
import { TextButton } from '../TextButton';
import ThreadMessageList from '../ThreadConversation/ThreadMessageList';
import { SubAgentPeekHeader } from './SubAgentPeekHeader';
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
  toolCallsById: Record<string, ThreadToolCall | undefined>,
  toolCallIdsByAssistantMessageId: Record<string, string[] | undefined>,
): number {
  const messages = messagesByThreadId[childThreadId] ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== 'assistant') continue;
    const toolCalls = (toolCallIdsByAssistantMessageId[message.id] ?? [])
      .map((id) => toolCallsById[id])
      .filter((tc): tc is ThreadToolCall => Boolean(tc));
    return toolCalls.filter((tc) => (
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
    pendingToolCallIdsByThread,
  } = useThreadStore(
    useShallow((state) => ({
      threadsById: state.threadsById,
      messagesByThreadId: state.messagesByThreadId,
      toolCallsById: state.toolCallsById,
      toolCallIdsByAssistantMessageId: state.toolCallIdsByAssistantMessageId,
      pendingToolCallIdsByThread: state.pendingToolCallIdsByThread,
    })),
  );

  const subAgents = useSubAgentStore((state) => state.subAgents);

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
      const thread = threadsById[tc.childThreadId] ?? {
        id: tc.childThreadId,
        projectId,
        threadType: 'subAgent' as const,
        parentId: null,
        journeyKind: null,
        displayLabel: null,
        status: 'running' as const,
        lastError: null,
        latestRunId: null,
        latestRunStatus: null,
        latestMessageAt: null,
        unresolvedToolCallCount: 0,
      };
      const agentName = tc.toolName.slice(5);
      const def = subAgents.find((s) => s.agent_name === agentName);
      result.push({
        key: tc.childThreadId,
        childThreadId: tc.childThreadId,
        displayName: def?.display_name ?? agentName,
        thread,
        callSeq: tc.callSeq,
      });
    }

    result.sort((a, b) => a.callSeq - b.callSeq);
    return result;
  }, [toolCallIdsByAssistantMessageId, toolCallsById, parentMessageId, threadsById, projectId, subAgents]);

  const pendingCountByKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of childEntries) {
      map[entry.key] = countPendingDecisions(
        entry.childThreadId,
        messagesByThreadId,
        toolCallsById,
        toolCallIdsByAssistantMessageId,
      );
    }
    return map;
  }, [childEntries, messagesByThreadId, toolCallIdsByAssistantMessageId, toolCallsById]);

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
  const [headerRef, headerHeight] = useMeasuredHeight<HTMLDivElement>();
  const [footerRef, footerHeight] = useMeasuredHeight<HTMLDivElement>();

  const selectedChildThreadId = selectedEntry?.childThreadId;
  const dockRef = useRef<HTMLDivElement | null>(null);
  const prevPeekOpenRef = useRef(peekOpen);

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
  const canPauseSelectedThread = canPauseThreadStatus(selectedThreadStatus);
  const canResumeSelectedThread = canResumeThreadStatus(selectedThreadStatus);

  useEffect(() => {
    const wasOpen = prevPeekOpenRef.current;
    prevPeekOpenRef.current = peekOpen;
    if (!peekOpen || wasOpen) return;

    const dock = dockRef.current;
    if (!dock) return;

    const timerId = setTimeout(() => {
      dock.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 280);
    return () => clearTimeout(timerId);
  }, [peekOpen]);

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
  const listFooterHeight = showFooter ? footerHeight : 0;

  return (
    <div className="sub-agent-peek-dock" ref={dockRef}>
      <div className={`sub-agent-peek-dock__body${peekOpen ? ' sub-agent-peek-dock__body--open' : ''}`}>
        <div className="sub-agent-peek-dock__body-inner">
          <div className="sub-agent-peek-dock__body-content">
            <ThreadMessageList
              threadId={selectedEntry.childThreadId}
              projectId={projectId}
              roleLabels={{ user: t('subAgent.parentAgent'), assistant: t('agent.ai') }}
              emptyState="No messages yet."
              topOverlayHeight={headerHeight}
              bottomOverlayHeight={listFooterHeight}
              stickyLatestUser={false}
            />

            <div className="sub-agent-peek-dock__header-overlay" ref={headerRef}>
              <SubAgentPeekHeader
                open={peekOpen}
                onToggle={() => setPeekOpen(peekKey, !peekOpen)}
                items={items}
                onSelect={(key) => setSelectedPeekRun(peekKey, key)}
              />
            </div>

            {showFooter && (
              <div className="sub-agent-peek-dock__footer-overlay" ref={footerRef}>
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
            </div>
            )}
          </div>
        </div>
      </div>

      {!peekOpen && (
        <div className="sub-agent-peek-dock__collapsed-header">
          <SubAgentPeekHeader
            open={peekOpen}
            onToggle={() => setPeekOpen(peekKey, !peekOpen)}
            items={items}
            onSelect={(key) => setSelectedPeekRun(peekKey, key)}
          />
        </div>
      )}
    </div>
  );
};

export default SubAgentPeekDock;

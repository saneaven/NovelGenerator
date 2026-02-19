import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import ChatEngine from '../../agent/chatEngine';
import { useThreadStore } from '../../store/threadStore';
import type { ThreadInfo, ThreadToolCall } from '../../types/thread';
import { threadPriority, isBlockingThreadStatus } from '../../types/thread';
import { useFunctionCallUIStore } from '../../toolCall/ui/store';
import { TextButton } from '../TextButton';
import { SubAgentPeekHeader } from './SubAgentPeekHeader';
import { SubAgentPeekTimeline } from './SubAgentPeekTimeline';
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

  const { threadsById, messagesByThreadId, toolCallsById, toolCallIdsByAssistantMessageId, toolCallsByMessageId } = useThreadStore(
    useShallow((state) => ({
      threadsById: state.threadsById,
      messagesByThreadId: state.messagesByThreadId,
      toolCallsById: state.toolCallsById,
      toolCallIdsByAssistantMessageId: state.toolCallIdsByAssistantMessageId,
      toolCallsByMessageId: state.toolCallsByMessageId,
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

  const prioritizedKeys = useMemo(() => {
    const next = [...orderedKeys];
    next.sort((a, b) => {
      const ae = entryByKey[a];
      const be = entryByKey[b];
      if (!ae || !be) return 0;

      const ap = threadPriority(ae.thread.status);
      const bp = threadPriority(be.thread.status);
      if (ap !== bp) return ap - bp;

      const aPending = pendingCountByKey[a] ?? 0;
      const bPending = pendingCountByKey[b] ?? 0;
      if (aPending !== bPending) return bPending - aPending;

      return 0;
    });
    return next;
  }, [orderedKeys, entryByKey, pendingCountByKey]);

  useEffect(() => {
    if (orderedKeys.length === 0) return;
    let nextSelectedKey = selectedKey;
    if (!selectedKey || !orderedKeys.includes(selectedKey)) {
      nextSelectedKey = prioritizedKeys[0] ?? orderedKeys[0];
    } else if (isActiveParent) {
      const selectedEntry = entryByKey[selectedKey];
      const prioritized = prioritizedKeys[0] ? entryByKey[prioritizedKeys[0]] : undefined;
      if (selectedEntry && prioritized) {
        const selectedBlocking = isBlockingThreadStatus(selectedEntry.thread.status);
        const prioritizedBlocking = isBlockingThreadStatus(prioritized.thread.status);
        const selectedPri = threadPriority(selectedEntry.thread.status);
        const prioritizedPri = threadPriority(prioritized.thread.status);

        if (
          (!selectedBlocking && prioritizedBlocking) ||
          (prioritizedPri === 0 && selectedPri !== 0)
        ) {
          nextSelectedKey = prioritized.key;
        }
      }
    }

    if (nextSelectedKey !== selectedKey) {
      setSelectedPeekRun(peekKey, nextSelectedKey);
    }
  }, [
    orderedKeys,
    selectedKey,
    setSelectedPeekRun,
    peekKey,
    isActiveParent,
    entryByKey,
    prioritizedKeys,
  ]);

  const selectedEntry = useMemo(() => {
    if (orderedKeys.length === 0) return undefined;
    const effective = selectedKey && orderedKeys.includes(selectedKey)
      ? selectedKey
      : prioritizedKeys[0] ?? orderedKeys[0];
    return childEntries.find((e) => e.key === effective);
  }, [childEntries, orderedKeys, selectedKey, prioritizedKeys]);

  // ── ChatEngine lifecycle ──
  const { t } = useTranslation();
  const engineRef = useRef<ChatEngine | null>(null);
  const [actionInFlight, setActionInFlight] = useState<'pause' | 'retry' | 'cancel' | null>(null);

  const selectedChildThreadId = selectedEntry?.childThreadId;

  useEffect(() => {
    if (!selectedChildThreadId) return;
    const engine = new ChatEngine({
      threadId: selectedChildThreadId,
      projectId,
      threadType: 'subAgent',
    });
    engineRef.current = engine;
    void engine.init().catch((error) => {
      console.error('Failed to init sub-agent engine', { childThreadId: selectedChildThreadId, error });
    });
    return () => {
      if (engineRef.current === engine) {
        engine.dispose();
        engineRef.current = null;
      }
    };
  }, [selectedChildThreadId, projectId]);

  // Reset action state when switching threads
  useEffect(() => {
    setActionInFlight(null);
  }, [selectedChildThreadId]);

  const selectedThreadStatus = selectedEntry?.thread.status ?? 'done';
  const isBlocking = isBlockingThreadStatus(selectedThreadStatus);

  const handlePause = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('pause');
    const op = engineRef.current ? engineRef.current.cancel() : Promise.resolve();
    void op.finally(() => setActionInFlight(null));
  }, [actionInFlight]);

  const handleRetry = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('retry');
    const op = engineRef.current ? engineRef.current.resume() : Promise.resolve();
    void op.finally(() => setActionInFlight(null));
  }, [actionInFlight]);

  const handleCancel = useCallback(() => {
    if (actionInFlight) return;
    setActionInFlight('cancel');
    const op = engineRef.current ? engineRef.current.cancel() : Promise.resolve();
    void op.finally(() => setActionInFlight(null));
  }, [actionInFlight]);

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
        <div className="sub-agent-peek-dock__body-inner">
          <SubAgentPeekTimeline
            childThreadId={selectedEntry.childThreadId}
            projectId={projectId}
            engine={engineRef.current}
          />
        </div>
      </div>

      {showFooter && (
        <div className="sub-agent-peek-dock__footer">
          {(selectedThreadStatus === 'running' || selectedThreadStatus === 'waiting') && (
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
          {(selectedThreadStatus === 'paused' || selectedThreadStatus === 'error') && (
            <>
              <TextButton
                size="sm"
                variant="primary"
                onClick={handleRetry}
                disabled={actionInFlight !== null}
                loading={actionInFlight === 'retry'}
              >
                {t('common.retry')}
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

import React, { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { useThreadStore, type ThreadInfo, type ThreadToolCall } from '../../runtime';
import { useFunctionCallUIStore } from '../../toolCall/ui/store';
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

function threadPriority(status: ThreadInfo['status']): number {
  switch (status) {
    case 'running':
      return 0;
    case 'waiting_tools':
      return 1;
    case 'paused':
      return 2;
    case 'error':
      return 3;
    case 'idle':
      return 4;
    default:
      return 5;
  }
}

function isBlockingThreadStatus(status: string): boolean {
  return status === 'running' || status === 'waiting_tools' || status === 'paused' || status === 'error';
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
    return toolCalls.filter((tc: any) => tc?.status === 'pending' || tc?.status === 'running').length;
  }
  return 0;
}

function threadStatusToDisplay(status: ThreadInfo['status']): string {
  if (status === 'waiting_tools') return 'waiting';
  if (status === 'idle') return 'completed';
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

  const { threadsById, messagesByThreadId, toolCallsByMessageId } = useThreadStore(
    useShallow((state) => ({
      threadsById: state.threadsById,
      messagesByThreadId: state.messagesByThreadId,
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
    const parentToolCalls: ThreadToolCall[] = toolCallsByMessageId[parentMessageId] ?? [];
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
  }, [toolCallsByMessageId, parentMessageId, threadsById]);

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

  if (childEntries.length === 0 || !selectedEntry) return null;

  // Extract finalOutput from parent tool call result
  const parentToolCalls: ThreadToolCall[] = toolCallsByMessageId[parentMessageId] ?? [];
  const selectedParentTc = parentToolCalls.find(
    (tc) => tc.childThreadId === selectedEntry.childThreadId,
  );
  const finalOutput = (selectedParentTc?.result as any)?.message ?? null;

  const items = childEntries.map((entry) => ({
    key: entry.key,
    displayName: entry.displayName,
    status: threadStatusToDisplay(entry.thread.status),
    pendingCount: pendingCountByKey[entry.key] ?? 0,
    selected: selectedEntry.key === entry.key,
  }));

  return (
    <div className="sub-agent-peek-dock">
      <SubAgentPeekHeader
        open={peekOpen}
        onToggle={() => setPeekOpen(peekKey, !peekOpen)}
        items={items}
        onSelect={(key) => setSelectedPeekRun(peekKey, key)}
      />

      <AnimatePresence initial={false}>
        {peekOpen && (
          <motion.div
            className="sub-agent-peek-dock__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <SubAgentPeekTimeline
              childThreadId={selectedEntry.childThreadId}
              projectId={projectId}
              finalOutput={finalOutput}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SubAgentPeekDock;

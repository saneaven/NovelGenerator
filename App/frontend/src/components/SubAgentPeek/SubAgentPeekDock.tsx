import React, { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import type { SubAgentRun, SubAgentParentType } from '../../store/subAgentRuntimeStore';
import { useSubAgentRuntimeStore } from '../../store/subAgentRuntimeStore';
import { useFunctionCallUIStore } from '../../toolCall/ui/store';
import { SubAgentPeekHeader } from './SubAgentPeekHeader';
import { SubAgentPeekTimeline } from './SubAgentPeekTimeline';
import './subAgentPeek.css';

interface RunEntry {
  key: string;
  run: SubAgentRun;
}

function runPriority(status: string): number {
  switch (status) {
    case 'running':
      return 0;
    case 'waiting':
      return 1;
    case 'paused':
      return 2;
    case 'error':
      return 3;
    case 'completed':
      return 4;
    case 'cancelled':
      return 5;
    default:
      return 6;
  }
}

function isBlockingRunStatus(status: string): boolean {
  return status === 'running' || status === 'waiting' || status === 'paused' || status === 'error';
}

function hasPendingToolDecisions(run: SubAgentRun): number {
  for (let i = run.history.length - 1; i >= 0; i--) {
    const message = run.history[i];
    if (message.role !== 'assistant') continue;
    const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
    return toolCalls.filter((toolCall: any) =>
      toolCall?.status === 'pending' ||
      toolCall?.status === 'validating' ||
      toolCall?.status === 'processing' ||
      toolCall?.status === 'running'
    ).length;
  }

  return 0;
}

function buildToolCallOrder(parentToolCallIds: string[]): Map<string, number> {
  const order = new Map<string, number>();
  parentToolCallIds.forEach((id, index) => {
    order.set(id, index);
  });
  return order;
}

export interface SubAgentPeekDockProps {
  threadId: string;
  parentType: SubAgentParentType;
  parentId: string;
  parentMessageId: string;
  parentToolCallIds: string[];
  isActiveParent: boolean;
}

export const SubAgentPeekDock: React.FC<SubAgentPeekDockProps> = ({
  threadId,
  parentType,
  parentId,
  parentMessageId,
  parentToolCallIds,
  isActiveParent,
}) => {
  const runsByKey = useSubAgentRuntimeStore((state) => state.runsByKey);

  const setPeekOpen = useFunctionCallUIStore((state) => state.setPeekOpen);
  const setSelectedPeekRun = useFunctionCallUIStore((state) => state.setSelectedPeekRun);

  const peekOpen = useFunctionCallUIStore(
    (state) => state.peekOpenByThread[threadId] ?? isActiveParent
  );
  const selectedKey = useFunctionCallUIStore(
    (state) => state.selectedPeekRunByThread[threadId]
  );

  const relevantRuns = useMemo(() => {
    const allowedToolCalls = new Set(parentToolCallIds);
    const result: Record<string, SubAgentRun> = {};
    for (const [key, run] of Object.entries(runsByKey)) {
      if (!run) continue;
      if (run.parentType !== parentType) continue;
      if (run.parentId !== parentId) continue;
      if (run.parentMessageId !== parentMessageId) continue;
      if (allowedToolCalls.size > 0 && !allowedToolCalls.has(run.parentToolCallId)) continue;
      result[key] = run;
    }
    return result;
  }, [runsByKey, parentToolCallIds, parentType, parentId, parentMessageId]);

  const entries = useMemo<RunEntry[]>(() => {
    const order = buildToolCallOrder(parentToolCallIds);

    const filtered = Object.entries(relevantRuns)
      .map(([key, run]) => ({ key, run }));

    filtered.sort((a, b) => {
      const ai = order.get(a.run.parentToolCallId);
      const bi = order.get(b.run.parentToolCallId);
      if (typeof ai === 'number' && typeof bi === 'number' && ai !== bi) return ai - bi;
      if (typeof ai === 'number') return -1;
      if (typeof bi === 'number') return 1;
      return a.key.localeCompare(b.key);
    });

    return filtered;
  }, [relevantRuns, parentToolCallIds]);

  const activeSessionIds = useMemo(
    () => entries.map((entry) => entry.run.activeSessionId).filter((id): id is string => typeof id === 'string' && id.length > 0),
    [entries]
  );

  const activeSessionSelector = useMemo(
    () => (state: ReturnType<typeof useLLMSessionStore.getState>) => {
      const sessions: Record<string, any> = {};
      for (const sessionId of activeSessionIds) {
        sessions[sessionId] = state.sessions[sessionId];
      }
      return sessions;
    },
    [activeSessionIds]
  );
  const activeSessionsById = useLLMSessionStore(useShallow(activeSessionSelector));

  const pendingCountByKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of entries) {
      map[entry.key] = hasPendingToolDecisions(entry.run);
    }
    return map;
  }, [entries]);

  const orderedKeys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const entryByKey = useMemo(() => {
    const map: Record<string, RunEntry | undefined> = {};
    for (const entry of entries) {
      map[entry.key] = entry;
    }
    return map;
  }, [entries]);
  const prioritizedKeys = useMemo(() => {
    const next = [...orderedKeys];
    next.sort((left, right) => {
      const leftEntry = entryByKey[left];
      const rightEntry = entryByKey[right];
      if (!leftEntry || !rightEntry) return 0;

      const leftPriorityVal = runPriority(leftEntry.run.status);
      const rightPriorityVal = runPriority(rightEntry.run.status);
      if (leftPriorityVal !== rightPriorityVal) return leftPriorityVal - rightPriorityVal;

      const leftPending = pendingCountByKey[left] ?? 0;
      const rightPending = pendingCountByKey[right] ?? 0;
      if (leftPending !== rightPending) return rightPending - leftPending;

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
        const selectedBlocking = isBlockingRunStatus(selectedEntry.run.status);
        const prioritizedBlocking = isBlockingRunStatus(prioritized.run.status);
        const selectedPriorityVal = runPriority(selectedEntry.run.status);
        const prioritizedPriorityVal = runPriority(prioritized.run.status);

        if (
          (!selectedBlocking && prioritizedBlocking) ||
          (prioritizedPriorityVal === 0 && selectedPriorityVal !== 0)
        ) {
          nextSelectedKey = prioritized.key;
        }
      }
    }

    if (nextSelectedKey !== selectedKey) {
      setSelectedPeekRun(threadId, nextSelectedKey);
    }
  }, [
    orderedKeys,
    selectedKey,
    setSelectedPeekRun,
    threadId,
    isActiveParent,
    entryByKey,
    prioritizedKeys,
  ]);

  const selectedEntry = useMemo(() => {
    if (orderedKeys.length === 0) return undefined;
    const effective = selectedKey && orderedKeys.includes(selectedKey)
      ? selectedKey
      : prioritizedKeys[0] ?? orderedKeys[0];
    return entries.find((entry) => entry.key === effective);
  }, [entries, orderedKeys, selectedKey, prioritizedKeys]);

  if (entries.length === 0 || !selectedEntry) return null;

  const items = entries.map((entry) => ({
    key: entry.key,
    displayName: entry.run.displayName || entry.run.agentName || entry.run.subAgentId,
    status: entry.run.status,
    pendingCount: pendingCountByKey[entry.key] ?? 0,
    selected: selectedEntry.key === entry.key,
  }));

  const selectedSession = selectedEntry.run.activeSessionId
    ? activeSessionsById[selectedEntry.run.activeSessionId]
    : undefined;

  return (
    <div className="sub-agent-peek-dock">
      <SubAgentPeekHeader
        open={peekOpen}
        onToggle={() => setPeekOpen(threadId, !peekOpen)}
        items={items}
        onSelect={(runKey) => setSelectedPeekRun(threadId, runKey)}
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
              threadId={threadId}
              runKey={selectedEntry.key}
              run={selectedEntry.run}
              activeSession={selectedSession}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SubAgentPeekDock;

import React, { useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useShallow } from 'zustand/react/shallow';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import type { SubAgentInvocation, SubAgentParentType } from '../../store/subAgentRuntimeStore';
import { useSubAgentRuntimeStore } from '../../store/subAgentRuntimeStore';
import { useFunctionCallUIStore } from '../../toolCall/ui/store';
import { SubAgentPeekHeader } from './SubAgentPeekHeader';
import { SubAgentPeekTimeline } from './SubAgentPeekTimeline';
import './subAgentPeek.css';

interface InvocationEntry {
  key: string;
  invocation: SubAgentInvocation;
}

function hasPendingToolDecisions(invocation: SubAgentInvocation): number {
  for (let i = invocation.history.length - 1; i >= 0; i--) {
    const message = invocation.history[i];
    if (message.role !== 'assistant') continue;
    const toolCalls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
    return toolCalls.filter((toolCall: any) =>
      toolCall?.status === 'pending' ||
      toolCall?.status === 'validating' ||
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
  const invocationsByKey = useSubAgentRuntimeStore((state) => state.invocationsByKey);
  const setPeekOpen = useFunctionCallUIStore((state) => state.setPeekOpen);
  const setSelectedPeekInvocation = useFunctionCallUIStore((state) => state.setSelectedPeekInvocation);

  const peekOpen = useFunctionCallUIStore(
    (state) => state.peekOpenByThread[threadId] ?? isActiveParent
  );
  const selectedKey = useFunctionCallUIStore(
    (state) => state.selectedPeekInvocationByThread[threadId]
  );

  const entries = useMemo<InvocationEntry[]>(() => {
    const allowedToolCalls = new Set(parentToolCallIds);
    const order = buildToolCallOrder(parentToolCallIds);

    const filtered = Object.entries(invocationsByKey)
      .filter(([, invocation]) => {
        if (!invocation) return false;
        if (invocation.parentType !== parentType) return false;
        if (invocation.parentId !== parentId) return false;
        if (invocation.parentMessageId !== parentMessageId) return false;
        if (allowedToolCalls.size > 0 && !allowedToolCalls.has(invocation.parentToolCallId)) return false;
        return true;
      })
      .map(([key, invocation]) => ({ key, invocation: invocation as SubAgentInvocation }));

    filtered.sort((a, b) => {
      const ai = order.get(a.invocation.parentToolCallId);
      const bi = order.get(b.invocation.parentToolCallId);
      if (typeof ai === 'number' && typeof bi === 'number' && ai !== bi) return ai - bi;
      if (typeof ai === 'number') return -1;
      if (typeof bi === 'number') return 1;
      return a.key.localeCompare(b.key);
    });

    return filtered;
  }, [invocationsByKey, parentToolCallIds, parentType, parentId, parentMessageId]);

  const activeSessionIds = useMemo(
    () => entries.map((entry) => entry.invocation.activeSessionId).filter((id): id is string => typeof id === 'string' && id.length > 0),
    [entries]
  );

  const sessionSelector = useMemo(
    () => (state: ReturnType<typeof useLLMSessionStore.getState>) => {
      const sessions: Record<string, any> = {};
      for (const sessionId of activeSessionIds) {
        sessions[sessionId] = state.sessions[sessionId];
      }
      return sessions;
    },
    [activeSessionIds]
  );
  const activeSessionsById = useLLMSessionStore(useShallow(sessionSelector));

  const pendingCountByKey = useMemo(() => {
    const map: Record<string, number> = {};
    for (const entry of entries) {
      map[entry.key] = hasPendingToolDecisions(entry.invocation);
    }
    return map;
  }, [entries]);

  const orderedKeys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const pendingKeys = useMemo(
    () => orderedKeys.filter((key) => (pendingCountByKey[key] ?? 0) > 0),
    [orderedKeys, pendingCountByKey]
  );

  useEffect(() => {
    if (orderedKeys.length === 0) return;
    if (!selectedKey || !orderedKeys.includes(selectedKey)) {
      setSelectedPeekInvocation(threadId, orderedKeys[0]);
      return;
    }

    if (!isActiveParent) return;

    const selectedHasPending = (pendingCountByKey[selectedKey] ?? 0) > 0;
    if (!selectedHasPending && pendingKeys.length > 0) {
      setSelectedPeekInvocation(threadId, pendingKeys[0]);
    }
  }, [
    orderedKeys,
    selectedKey,
    setSelectedPeekInvocation,
    threadId,
    isActiveParent,
    pendingCountByKey,
    pendingKeys,
  ]);

  const selectedEntry = useMemo(() => {
    if (orderedKeys.length === 0) return undefined;
    const effective = selectedKey && orderedKeys.includes(selectedKey) ? selectedKey : orderedKeys[0];
    return entries.find((entry) => entry.key === effective);
  }, [entries, orderedKeys, selectedKey]);

  if (entries.length === 0 || !selectedEntry) return null;

  const items = entries.map((entry) => ({
    key: entry.key,
    displayName: entry.invocation.displayName || entry.invocation.agentName || entry.invocation.subAgentId,
    status: entry.invocation.status,
    pendingCount: pendingCountByKey[entry.key] ?? 0,
    selected: selectedEntry.key === entry.key,
  }));

  const selectedSession = selectedEntry.invocation.activeSessionId
    ? activeSessionsById[selectedEntry.invocation.activeSessionId]
    : undefined;

  return (
    <div className="sub-agent-peek-dock">
      <SubAgentPeekHeader
        open={peekOpen}
        onToggle={() => setPeekOpen(threadId, !peekOpen)}
        items={items}
        onSelect={(invocationKey) => setSelectedPeekInvocation(threadId, invocationKey)}
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
              invocationKey={selectedEntry.key}
              invocation={selectedEntry.invocation}
              activeSession={selectedSession}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SubAgentPeekDock;

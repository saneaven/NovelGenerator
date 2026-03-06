import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useThreadStore } from '../store/threadStore';
import { selectThreadLiveViewState, type ThreadLiveViewState } from '../runtime/threadLiveViewState';

export function useThreadLiveViewState(threadId: string | null | undefined): ThreadLiveViewState | null {
  const snapshot = useThreadStore(
    useShallow((state) => ({
      thread: threadId ? state.threadsById[threadId] : undefined,
      messages: threadId ? state.messagesByThreadId[threadId] : undefined,
      toolCallsById: state.toolCallsById,
      toolCallIdsByAssistantMessageId: state.toolCallIdsByAssistantMessageId,
      isPreexistingLiveThread: threadId ? Boolean(state.preexistingLiveThreadsById[threadId]) : false,
    })),
  );

  return useMemo(() => selectThreadLiveViewState({
    threadsById: threadId && snapshot.thread ? { [threadId]: snapshot.thread } : {},
    messagesByThreadId: threadId && snapshot.messages ? { [threadId]: snapshot.messages } : {},
    toolCallsById: snapshot.toolCallsById,
    toolCallIdsByAssistantMessageId: snapshot.toolCallIdsByAssistantMessageId,
    preexistingLiveThreadsById: threadId && snapshot.isPreexistingLiveThread ? { [threadId]: true } : {},
  }, threadId), [
    threadId,
    snapshot.thread,
    snapshot.messages,
    snapshot.toolCallsById,
    snapshot.toolCallIdsByAssistantMessageId,
    snapshot.isPreexistingLiveThread,
  ]);
}

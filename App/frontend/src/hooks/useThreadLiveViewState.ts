import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useThreadStreamStore } from '../store/threadStreamStore';
import type { ThreadMessage, ThreadToolCall } from '../types/thread';
import type { ThreadLiveViewState } from '../runtime/threadLiveViewState';
import { isLiveThreadStatus } from '../runtime/threadStreamLifecycle';

const EMPTY_OVERLAY: ThreadMessage[] = [];
const EMPTY_TOOL_CALLS: ThreadToolCall[] = [];
const EMPTY_CONTENT_PARTS: Array<{ type: 'content'; text: string }> = [];

/**
 * Live view state for a thread. The streaming assistant message and its streaming
 * tool calls live entirely in the overlay store (finalized snapshot messages are
 * never `isStreaming`), so this reads purely from `threadStreamStore`.
 */
export function useThreadLiveViewState(threadId: string | null | undefined): ThreadLiveViewState | null {
  const thread = useThreadStreamStore((state) => (threadId ? state.threadsById[threadId] : undefined));
  const overlayMessages = useThreadStreamStore((state) => (threadId ? state.overlayMessagesByThread[threadId] ?? EMPTY_OVERLAY : EMPTY_OVERLAY));
  const isPreexistingLiveThread = useThreadStreamStore((state) => (threadId ? Boolean(state.preexistingLiveThreadsById[threadId]) : false));

  const streamingMessage = useMemo(
    () => overlayMessages.find((message) => message.role === 'assistant' && message.isStreaming) ?? null,
    [overlayMessages],
  );

  const streamingToolCalls = useThreadStreamStore(
    useShallow((state) => {
      if (!streamingMessage?.id) return EMPTY_TOOL_CALLS;
      const next = Object.values(state.streamingToolCallsById)
        .filter((toolCall): toolCall is ThreadToolCall => Boolean(toolCall))
        .filter((toolCall) => toolCall.assistantMessageId === streamingMessage.id && toolCall.status === 'streaming');
      return next.length > 0 ? next : EMPTY_TOOL_CALLS;
    }),
  );

  return useMemo(() => {
    if (!threadId) return null;

    const suppressed = isPreexistingLiveThread && isLiveThreadStatus(thread?.status);

    return {
      threadId,
      status: thread?.status ?? 'idle',
      deliveryMode: suppressed ? 'suppressed' : 'live',
      hasStreamingMessage: Boolean(streamingMessage),
      streamingMessageId: streamingMessage?.id ?? null,
      contentParts: suppressed ? EMPTY_CONTENT_PARTS : (streamingMessage?.streamingData?.contentParts ?? EMPTY_CONTENT_PARTS),
      reasoningDetail: suppressed ? undefined : streamingMessage?.streamingData?.reasoningDetail,
      streamingToolCalls: suppressed ? EMPTY_TOOL_CALLS : streamingToolCalls,
      noticeKind: suppressed && !streamingMessage ? 'preexisting_live_run' : 'none',
      error: typeof thread?.lastError === 'string' ? thread.lastError : undefined,
    };
  }, [
    threadId,
    thread,
    streamingMessage,
    streamingToolCalls,
    isPreexistingLiveThread,
  ]);
}

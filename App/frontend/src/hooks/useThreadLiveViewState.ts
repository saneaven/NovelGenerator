import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useThreadStore } from '../store/threadStore';
import type { ThreadMessage, ThreadToolCall } from '../types/thread';
import type { ThreadLiveViewState } from '../runtime/threadLiveViewState';
import { isLiveThreadStatus } from '../runtime/threadStreamLifecycle';

const EMPTY_MESSAGES: ThreadMessage[] = [];
const EMPTY_TOOL_CALL_IDS: string[] = [];
const EMPTY_TOOL_CALLS: ThreadToolCall[] = [];
const EMPTY_CONTENT_PARTS: Array<{ type: 'content'; text: string }> = [];

export function useThreadLiveViewState(threadId: string | null | undefined): ThreadLiveViewState | null {
  const thread = useThreadStore((state) => (threadId ? state.threadsById[threadId] : undefined));
  const messages = useThreadStore((state) => (threadId ? (state.messagesByThreadId[threadId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES));
  const isPreexistingLiveThread = useThreadStore((state) => (threadId ? Boolean(state.preexistingLiveThreadsById[threadId]) : false));

  const streamingMessage = useMemo(
    () => messages.find((message) => message.role === 'assistant' && message.isStreaming) ?? null,
    [messages],
  );

  const streamingToolCallIds = useThreadStore(
    useShallow((state) => {
      if (!streamingMessage?.id) return EMPTY_TOOL_CALL_IDS;
      return state.toolCallIdsByAssistantMessageId[streamingMessage.id] ?? EMPTY_TOOL_CALL_IDS;
    }),
  );

  const streamingToolCalls = useThreadStore(
    useShallow((state) => {
      if (streamingToolCallIds.length === 0) return EMPTY_TOOL_CALLS;
      const next = streamingToolCallIds
        .map((id) => state.toolCallsById[id])
        .filter((toolCall): toolCall is ThreadToolCall => Boolean(toolCall))
        .filter((toolCall) => toolCall.status === 'streaming');
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

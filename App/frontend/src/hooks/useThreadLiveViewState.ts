import { useMemo } from 'react';
import { useThreadStreamStore } from '../store/threadStreamStore';
import { useThreadMessagesQuery } from '../data/threads';
import type { ThreadMessage, ThreadToolCall } from '../types/thread';
import type { ThreadLiveViewState } from '../runtime/threadLiveViewState';
import { isLiveThreadStatus } from '../runtime/threadStreamLifecycle';

const EMPTY_MESSAGES: ThreadMessage[] = [];
const EMPTY_TOOL_CALLS: ThreadToolCall[] = [];
const EMPTY_CONTENT_PARTS: Array<{ type: 'content'; text: string }> = [];

/**
 * Live view state for a thread. The streaming assistant message and its streaming
 * tool calls live in the snapshot cache (the single source of truth); thread
 * status / preexisting-live signals come from threadStreamStore. Reads the cache
 * passively (enabled:false) so this hook never triggers a fetch of its own.
 */
export function useThreadLiveViewState(threadId: string | null | undefined): ThreadLiveViewState | null {
  const thread = useThreadStreamStore((state) => (threadId ? state.threadsById[threadId] : undefined));
  const isPreexistingLiveThread = useThreadStreamStore((state) => (threadId ? Boolean(state.preexistingLiveThreadsById[threadId]) : false));

  const snapshot = useThreadMessagesQuery(threadId, { enabled: false }).data;
  const messages = snapshot?.messages ?? EMPTY_MESSAGES;
  const toolCalls = snapshot?.toolCalls ?? EMPTY_TOOL_CALLS;

  const streamingMessage = useMemo(
    () => messages.find((message) => message.role === 'assistant' && message.isStreaming) ?? null,
    [messages],
  );

  const streamingToolCalls = useMemo(() => {
    if (!streamingMessage?.id) return EMPTY_TOOL_CALLS;
    const next = toolCalls.filter(
      (toolCall) => toolCall.assistantMessageId === streamingMessage.id && toolCall.status === 'streaming',
    );
    return next.length > 0 ? next : EMPTY_TOOL_CALLS;
  }, [toolCalls, streamingMessage]);

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

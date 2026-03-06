import type { ThreadState } from '../store/threadStore';
import type { ReasoningDetail, ThreadStatus, ThreadToolCall } from '../types/thread';
import { isLiveThreadStatus } from './threadStreamLifecycle';

const EMPTY_CONTENT_PARTS: Array<{ type: 'content'; text: string }> = [];
const EMPTY_TOOL_CALLS: ThreadToolCall[] = [];

export interface ThreadLiveViewState {
  threadId: string;
  status: 'idle' | ThreadStatus;
  deliveryMode: 'live' | 'suppressed';
  hasStreamingMessage: boolean;
  streamingMessageId: string | null;
  contentParts: Array<{ type: 'content'; text: string }>;
  reasoningDetail: ReasoningDetail | undefined;
  streamingToolCalls: ThreadToolCall[];
  noticeKind: 'none' | 'preexisting_live_run';
  error: string | undefined;
}

export type ThreadStateLike = Pick<
  ThreadState,
  | 'threadsById'
  | 'messagesByThreadId'
  | 'toolCallsById'
  | 'toolCallIdsByAssistantMessageId'
  | 'preexistingLiveThreadsById'
>;

export function selectThreadLiveViewState(
  state: ThreadStateLike,
  threadId: string | null | undefined,
): ThreadLiveViewState | null {
  if (!threadId) return null;

  const thread = state.threadsById[threadId];
  const messages = state.messagesByThreadId[threadId] ?? [];
  const streamingMessage = messages.find((message) => message.role === 'assistant' && message.isStreaming) ?? null;
  const suppressed = Boolean(state.preexistingLiveThreadsById[threadId]) && isLiveThreadStatus(thread?.status);
  const streamingToolCalls = streamingMessage
    ? (state.toolCallIdsByAssistantMessageId[streamingMessage.id] ?? [])
      .map((id) => state.toolCallsById[id])
      .filter((toolCall): toolCall is ThreadToolCall => Boolean(toolCall))
      .filter((toolCall) => toolCall.status === 'streaming')
    : EMPTY_TOOL_CALLS;

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
}

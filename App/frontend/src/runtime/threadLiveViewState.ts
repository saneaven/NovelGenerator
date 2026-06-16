import type { ReasoningDetail, ThreadStatus, ThreadToolCall } from '../types/thread';

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

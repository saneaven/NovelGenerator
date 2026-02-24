/**
 * Derives a streaming session object from journey + thread Zustand stores.
 * Used by ImageGenerationModal and ImagePromptManager to show real-time
 * AI-assist prompt generation and detect completion.
 */

import { useMemo } from 'react';
import { useJourneyStore } from '../store/journeyStore';
import { useThreadStore } from '../store/threadStore';
import type { ReasoningDetail } from '../types/thread';

export interface JourneyStreamingSession {
  status: 'running' | 'done' | 'error';
  contentParts: Array<{ type: 'content'; text: string }>;
  reasoningDetail: ReasoningDetail | undefined;
  error: string | undefined;
  toolCallProgress: Array<{
    draft: { parsedArguments: Record<string, unknown> };
  }>;
  threadId: string | undefined;
}

export function useJourneyStreamingSession(
  journeyId: string | null,
): JourneyStreamingSession | null {
  const threadId = useJourneyStore((state) =>
    journeyId ? state.journeys[journeyId]?.threadId : undefined
  );
  const journeyError = useJourneyStore((state) =>
    journeyId ? state.journeys[journeyId]?.error : undefined
  );

  const threadStatus = useThreadStore((state) =>
    threadId ? state.threadsById[threadId]?.status : undefined
  );
  const threadError = useThreadStore((state) =>
    threadId ? state.threadsById[threadId]?.lastError : undefined
  );
  const isStreamActive = useThreadStore((state) =>
    threadId ? Boolean(state.activeStreamByThread[threadId]) : false
  );

  const threadMessages = useThreadStore((state) =>
    threadId ? state.messagesByThreadId[threadId] : undefined
  );

  const toolCallsById = useThreadStore((state) => state.toolCallsById);

  const streamingMessage = useMemo(() => {
    if (!threadMessages) return undefined;
    return threadMessages.find(m => m.role === 'assistant' && m.isStreaming);
  }, [threadMessages]);

  const streamingToolCalls = useMemo(() => {
    if (!streamingMessage) return [];
    const ids = useThreadStore.getState().toolCallIdsByMessageId[streamingMessage.id];
    if (!ids) return [];
    return ids
      .map(id => toolCallsById[id])
      .filter(tc => tc != null && tc.status === 'streaming');
  }, [streamingMessage, toolCallsById]);

  return useMemo((): JourneyStreamingSession | null => {
    if (!journeyId) return null;

    if (journeyError) {
      return {
        status: 'error',
        contentParts: [],
        reasoningDetail: undefined,
        error: journeyError,
        toolCallProgress: [],
        threadId: undefined,
      };
    }

    if (!threadId) return null;

    let status: JourneyStreamingSession['status'];
    if (isStreamActive || threadStatus === 'running' || threadStatus === 'processing') {
      status = 'running';
    } else if (threadStatus === 'error') {
      status = 'error';
    } else if (threadStatus === 'done' || threadStatus === 'canceled') {
      status = 'done';
    } else {
      // waiting, paused, or unknown — treat as running (still in progress)
      status = 'running';
    }

    const contentParts = streamingMessage?.streamingData?.contentParts ?? [];
    const reasoningDetail = streamingMessage?.streamingData?.reasoningDetail;

    const toolCallProgress = streamingToolCalls.map(tc => ({
      draft: { parsedArguments: (tc!.arguments ?? {}) as Record<string, unknown> },
    }));

    return {
      status,
      contentParts,
      reasoningDetail,
      error: status === 'error' ? (threadError ?? 'Unknown error') : undefined,
      toolCallProgress,
      threadId,
    };
  }, [
    journeyId, journeyError, threadId, threadStatus, threadError,
    isStreamActive, streamingMessage, streamingToolCalls,
  ]);
}

/**
 * Thread-centric Zustand store.
 * State is keyed by threadId — run details are tracked only for status and sequencing.
 */

import { create } from 'zustand';
import type {
  ThreadInfo,
  ThreadMessage,
  ThreadToolCall,
} from '../types/thread';
import { revokeMessageAttachmentObjectUrls } from '../utils/threadAttachments';

export type { ThreadInfo, ThreadMessage, ThreadToolCall };
export type { ThreadType, ThreadStatus } from '../types/thread';

export interface FinalizeMessageFromEndParams {
  threadId: string;
  messageId: string;
  runId: string;
  seqInThread?: number;
  data?: ThreadMessage['data'];
  ts?: string;
}

export interface ThreadState {
  threadsById: Record<string, ThreadInfo | undefined>;
  messagesByThreadId: Record<string, ThreadMessage[] | undefined>;
  preexistingLiveThreadsById: Record<string, true | undefined>;

  toolCallsById: Record<string, ThreadToolCall | undefined>;
  toolCallIdsByMessageId: Record<string, string[] | undefined>;
  toolCallIdsByAssistantMessageId: Record<string, string[] | undefined>;

  // Legacy selectors still consume this map in several components.
  toolCallsByMessageId: Record<string, ThreadToolCall[] | undefined>;

  pendingToolCallIdsByThread: Record<string, string[] | undefined>;
  pendingToolCallMessageByThread: Record<string, string | undefined>;
  activeStreamByThread: Record<string, boolean | undefined>;

  upsertThread: (thread: ThreadInfo) => void;
  upsertThreadsRuntime: (threads: ThreadInfo[]) => void;
  setThreadRuntime: (threadId: string, partial: Partial<ThreadInfo>) => void;
  patchThread: (threadId: string, partial: Partial<ThreadInfo>) => void;
  removeThread: (threadId: string) => void;
  removeThreadCascade: (threadId: string) => void;
  removeThreadsCascade: (threadIds: string[]) => void;
  getThread: (threadId: string) => ThreadInfo | undefined;
  markPreexistingLiveThreads: (threadIds: string[]) => void;
  clearPreexistingLiveThread: (threadId: string) => void;
  isPreexistingLiveThread: (threadId: string) => boolean;

  upsertMessage: (message: ThreadMessage) => void;
  upsertMessages: (messages: ThreadMessage[]) => void;
  finalizeMessageFromEnd: (params: FinalizeMessageFromEndParams) => void;
  appendMessage: (message: ThreadMessage) => void;
  patchMessage: (threadId: string, messageId: string, partial: Partial<ThreadMessage>) => void;
  removeMessage: (threadId: string, messageId: string) => void;
  getMessages: (threadId: string) => ThreadMessage[];
  replaceThreadMessages: (threadId: string, messages: ThreadMessage[]) => void;
  updateMessageData: (
    threadId: string,
    messageId: string,
    language: string,
    entry: ThreadMessage['data'][string],
  ) => void;


  upsertToolCall: (toolCall: ThreadToolCall) => void;
  patchToolCall: (toolCallId: string, partial: Partial<ThreadToolCall>) => void;
  removeToolCall: (toolCallId: string) => void;

  upsertToolCalls: (messageId: string, toolCalls: ThreadToolCall[]) => void;
  replaceToolCallsForAssistant: (assistantMessageId: string, newToolCalls: ThreadToolCall[]) => void;
  replaceThreadToolCalls: (threadId: string, toolCalls: ThreadToolCall[]) => void;
  getToolCalls: (messageId: string) => ThreadToolCall[];
  getToolCallsForAssistantMessage: (assistantMessageId: string) => ThreadToolCall[];

  setPendingToolCallMessage: (threadId: string, messageId: string) => void;
  clearPendingToolCallMessage: (threadId: string) => void;

  setThreadStreamActive: (threadId: string, active: boolean) => void;
  isThreadStreamActive: (threadId: string) => boolean;
  clearThreadStreamingState: (threadId: string) => void;

  findThreadByParent: (projectId: string, parentId: string) => ThreadInfo | undefined;

  clearAll: () => void;
}

function sortMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return [...messages].sort((a, b) => a.seqInThread - b.seqInThread);
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
}

function mergeThreadInfo(
  existing: ThreadInfo,
  partial: Partial<ThreadInfo>,
): { changed: boolean; nextValue: ThreadInfo } {
  let changed = false;
  const nextValue: ThreadInfo = { ...existing };

  for (const [key, value] of Object.entries(partial) as Array<[keyof ThreadInfo, ThreadInfo[keyof ThreadInfo]]>) {
    if (Object.is(existing[key], value)) continue;
    nextValue[key] = value as never;
    changed = true;
  }

  return {
    changed,
    nextValue: changed ? nextValue : existing,
  };
}

function buildMessageMap(toolCallsById: Record<string, ThreadToolCall | undefined>): Record<string, ThreadToolCall[] | undefined> {
  const byMessageId: Record<string, ThreadToolCall[]> = {};
  for (const tc of Object.values(toolCallsById)) {
    if (!tc) continue;
    const existing = byMessageId[tc.messageId] ?? [];
    byMessageId[tc.messageId] = [...existing, tc];
  }
  return byMessageId;
}

function buildToolCallIdsByMessageId(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
): Record<string, string[] | undefined> {
  const out: Record<string, string[]> = {};
  for (const tc of Object.values(toolCallsById)) {
    if (!tc || !tc.messageId) continue;
    out[tc.messageId] = uniqueIds([...(out[tc.messageId] ?? []), tc.id]);
  }
  return out;
}

function buildToolCallIdsByAssistantMessageId(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
): Record<string, string[] | undefined> {
  const out: Record<string, string[]> = {};
  for (const tc of Object.values(toolCallsById)) {
    if (!tc || !tc.assistantMessageId) continue;
    out[tc.assistantMessageId] = uniqueIds([...(out[tc.assistantMessageId] ?? []), tc.id]);
  }
  return out;
}

function buildPendingByThread(toolCallsById: Record<string, ThreadToolCall | undefined>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const tc of Object.values(toolCallsById)) {
    if (!tc) continue;
    if (tc.status !== 'pending') continue;
    const current = out[tc.threadId] ?? [];
    current.push(tc.id);
    out[tc.threadId] = current;
  }
  return out;
}

function buildPendingMessageByThread(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
  pendingToolCallIdsByThread: Record<string, string[]>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [threadId, ids] of Object.entries(pendingToolCallIdsByThread)) {
    const first = ids[0];
    if (!first) continue;
    const row = toolCallsById[first];
    if (row) {
      out[threadId] = row.messageId;
    }
  }
  return out;
}

function hasMessageData(data: ThreadMessage['data'] | undefined): boolean {
  return Boolean(data && Object.keys(data).length > 0);
}

function fallbackDataFromStreaming(message: ThreadMessage | undefined): ThreadMessage['data'] | undefined {
  const streaming = message?.streamingData;
  if (!streaming) return undefined;
  const hasContentParts = Array.isArray(streaming.contentParts) && streaming.contentParts.length > 0;
  const hasReasoning = streaming.reasoningDetail !== undefined;
  if (!hasContentParts && !hasReasoning) return undefined;
  const preferLanguage = Object.keys(message.data ?? {})[0];
  const entry = {
    contentParts: streaming.contentParts ?? [],
    ...(streaming.reasoningDetail !== undefined
      ? { reasoningDetail: streaming.reasoningDetail }
      : {}),
  };
  return {
    ...(message.data ?? {}),
    [preferLanguage]: entry,
  };
}

function buildThreadScopedToolCallState(
  toolCallsById: Record<string, ThreadToolCall | undefined>,
): Pick<
  ThreadState,
  | 'toolCallsById'
  | 'toolCallIdsByMessageId'
  | 'toolCallIdsByAssistantMessageId'
  | 'toolCallsByMessageId'
  | 'pendingToolCallIdsByThread'
  | 'pendingToolCallMessageByThread'
> {
  const pendingToolCallIdsByThread = buildPendingByThread(toolCallsById);
  return {
    toolCallsById,
    toolCallIdsByMessageId: buildToolCallIdsByMessageId(toolCallsById),
    toolCallIdsByAssistantMessageId: buildToolCallIdsByAssistantMessageId(toolCallsById),
    toolCallsByMessageId: buildMessageMap(toolCallsById),
    pendingToolCallIdsByThread,
    pendingToolCallMessageByThread: buildPendingMessageByThread(toolCallsById, pendingToolCallIdsByThread),
  };
}

function removeThreadsCascadeState(state: ThreadState, threadIds: string[]): Partial<ThreadState> | ThreadState {
  if (threadIds.length === 0) return state;

  const toDelete = new Set(threadIds);
  const nextThreadsById = { ...state.threadsById };
  const nextMessagesByThreadId = { ...state.messagesByThreadId };
  const nextPreexistingLiveThreadsById = { ...state.preexistingLiveThreadsById };
  const nextActiveStreamByThread = { ...state.activeStreamByThread };

  for (const threadId of toDelete) {
    for (const message of nextMessagesByThreadId[threadId] ?? []) {
      revokeMessageAttachmentObjectUrls(message);
    }
    delete nextThreadsById[threadId];
    delete nextMessagesByThreadId[threadId];
    delete nextPreexistingLiveThreadsById[threadId];
    delete nextActiveStreamByThread[threadId];
  }

  const nextToolCallsById: Record<string, ThreadToolCall | undefined> = {};
  for (const [toolCallId, toolCall] of Object.entries(state.toolCallsById)) {
    if (!toolCall || toDelete.has(toolCall.threadId)) continue;
    nextToolCallsById[toolCallId] = toolCall;
  }

  return {
    threadsById: nextThreadsById,
    messagesByThreadId: nextMessagesByThreadId,
    preexistingLiveThreadsById: nextPreexistingLiveThreadsById,
    ...buildThreadScopedToolCallState(nextToolCallsById),
    activeStreamByThread: nextActiveStreamByThread,
  };
}

export const useThreadStore = create<ThreadState>()((set, get) => ({
  threadsById: {},
  messagesByThreadId: {},
  preexistingLiveThreadsById: {},

  toolCallsById: {},
  toolCallIdsByMessageId: {},
  toolCallIdsByAssistantMessageId: {},
  toolCallsByMessageId: {},

  pendingToolCallIdsByThread: {},
  pendingToolCallMessageByThread: {},
  activeStreamByThread: {},

  upsertThread: (thread) =>
    set((s) => {
      const existing = s.threadsById[thread.id];
      if (existing) {
        const { changed, nextValue } = mergeThreadInfo(existing, thread);
        if (!changed) return s;
        return {
          threadsById: { ...s.threadsById, [thread.id]: nextValue },
        };
      }

      return {
        threadsById: { ...s.threadsById, [thread.id]: thread },
      };
    }),

  upsertThreadsRuntime: (threads) =>
    set((s) => {
      if (threads.length === 0) return s;
      const nextThreads = { ...s.threadsById };
      let changed = false;
      for (const thread of threads) {
        const existing = nextThreads[thread.id];
        if (!existing) {
          nextThreads[thread.id] = thread;
          changed = true;
          continue;
        }
        const merged = mergeThreadInfo(existing, thread);
        if (!merged.changed) continue;
        nextThreads[thread.id] = merged.nextValue;
        changed = true;
      }
      if (!changed) return s;
      return { threadsById: nextThreads };
    }),

  setThreadRuntime: (threadId, partial) =>
    set((s) => {
      const existing = s.threadsById[threadId];
      if (!existing) return s;
      const { changed, nextValue } = mergeThreadInfo(existing, partial);
      if (!changed) return s;
      return {
        threadsById: { ...s.threadsById, [threadId]: nextValue },
      };
    }),

  patchThread: (threadId, partial) =>
    set((s) => {
      const existing = s.threadsById[threadId];
      if (!existing) return s;
      const { changed, nextValue } = mergeThreadInfo(existing, partial);
      if (!changed) return s;
      return {
        threadsById: { ...s.threadsById, [threadId]: nextValue },
      };
    }),

  removeThread: (threadId) =>
    set((s) => {
      for (const message of s.messagesByThreadId[threadId] ?? []) {
        revokeMessageAttachmentObjectUrls(message);
      }
      const { [threadId]: _, ...rest } = s.threadsById;
      const { [threadId]: __, ...restMsgs } = s.messagesByThreadId;
      const { [threadId]: ___, ...restPreexisting } = s.preexistingLiveThreadsById;
      return {
        threadsById: rest,
        messagesByThreadId: restMsgs,
        preexistingLiveThreadsById: restPreexisting,
      };
    }),

  removeThreadCascade: (threadId) =>
    set((s) => removeThreadsCascadeState(s, [threadId])),

  removeThreadsCascade: (threadIds) =>
    set((s) => removeThreadsCascadeState(s, threadIds)),

  getThread: (threadId) => get().threadsById[threadId],

  markPreexistingLiveThreads: (threadIds) =>
    set((s) => {
      if (threadIds.length === 0) return s;
      const next = { ...s.preexistingLiveThreadsById };
      for (const threadId of threadIds) {
        if (!threadId) continue;
        next[threadId] = true;
      }
      return { preexistingLiveThreadsById: next };
    }),

  clearPreexistingLiveThread: (threadId) =>
    set((s) => {
      if (!s.preexistingLiveThreadsById[threadId]) return s;
      const { [threadId]: _, ...rest } = s.preexistingLiveThreadsById;
      return { preexistingLiveThreadsById: rest };
    }),

  isPreexistingLiveThread: (threadId) => Boolean(get().preexistingLiveThreadsById[threadId]),

  upsertMessage: (message) =>
    set((s) => {
      const existing = s.messagesByThreadId[message.threadId] ?? [];
      const index = existing.findIndex((m) => m.id === message.id);
      if (index < 0) {
        return {
          messagesByThreadId: {
            ...s.messagesByThreadId,
            [message.threadId]: sortMessages([...existing, message]),
          },
        };
      }

      const merged = existing.map((m) => {
        if (m.id !== message.id) return m;
        const next = { ...m, ...message };
        // Preserve streaming state — API hydration must not kill an active stream.
        if (m.isStreaming && !message.isStreaming) {
          next.isStreaming = true;
          next.streamingData = m.streamingData;
        }
        return next;
      });
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [message.threadId]: sortMessages(merged),
        },
      };
    }),

  upsertMessages: (messages) =>
    set((s) => {
      if (messages.length === 0) return s;
      const nextByThread = { ...s.messagesByThreadId };
      for (const message of messages) {
        const existing = nextByThread[message.threadId] ?? [];
        const index = existing.findIndex((m) => m.id === message.id);
        if (index < 0) {
          nextByThread[message.threadId] = [...existing, message];
        } else {
          nextByThread[message.threadId] = existing.map((m) => (m.id === message.id ? { ...m, ...message } : m));
        }
      }
      // Sort each modified thread's messages once
      for (const threadId of new Set(messages.map((m) => m.threadId))) {
        nextByThread[threadId] = sortMessages(nextByThread[threadId] ?? []);
      }
      return { messagesByThreadId: nextByThread };
    }),

  finalizeMessageFromEnd: (params) =>
    set((s) => {
      const messages = s.messagesByThreadId[params.threadId] ?? [];
      const existing = messages.find((m) => m.id === params.messageId);
      const fallbackData = fallbackDataFromStreaming(existing);
      const finalData = hasMessageData(params.data)
        ? params.data!
        : (fallbackData ?? existing?.data ?? {});

      const finalized: ThreadMessage = existing
        ? {
            ...existing,
            runId: params.runId,
            data: finalData,
            seqInThread: Number(params.seqInThread ?? existing.seqInThread ?? 0),
            streamingData: undefined,
            isStreaming: false,
          }
        : {
            id: params.messageId,
            threadId: params.threadId,
            runId: params.runId,
            role: 'assistant',
            seq: 0,
            seqInThread: Number(params.seqInThread ?? 0),
            data: finalData,
            attachments: [],
            streamingData: undefined,
            isStreaming: false,
            createdAt: params.ts ?? new Date().toISOString(),
          };

      const nextMessages = existing
        ? messages.map((m) => (m.id === params.messageId ? finalized : m))
        : [...messages, finalized];

      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [params.threadId]: sortMessages(nextMessages),
        },
        activeStreamByThread: {
          ...s.activeStreamByThread,
          [params.threadId]: false,
        },
      };
    }),

  appendMessage: (message) =>
    set((s) => {
      const existing = s.messagesByThreadId[message.threadId] ?? [];
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [message.threadId]: sortMessages([...existing, message]),
        },
      };
    }),

  patchMessage: (threadId, messageId, partial) =>
    set((s) => {
      const msgs = s.messagesByThreadId[threadId];
      if (!msgs) return s;
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [threadId]: msgs.map((m) => (m.id === messageId ? { ...m, ...partial } : m)),
        },
      };
    }),

  removeMessage: (threadId, messageId) =>
    set((s) => {
      const msgs = s.messagesByThreadId[threadId];
      if (!msgs) return s;
      const removed = msgs.find((m) => m.id === messageId);
      if (removed) {
        revokeMessageAttachmentObjectUrls(removed);
      }
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [threadId]: msgs.filter((m) => m.id !== messageId),
        },
      };
    }),

  getMessages: (threadId) => get().messagesByThreadId[threadId] ?? [],

  replaceThreadMessages: (threadId, messages) =>
    set((s) => {
      const incomingIds = new Set(messages.map((message) => message.id));
      for (const existing of s.messagesByThreadId[threadId] ?? []) {
        if (!incomingIds.has(existing.id)) {
          revokeMessageAttachmentObjectUrls(existing);
        }
      }
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [threadId]: sortMessages(messages),
        },
      };
    }),

  updateMessageData: (threadId, messageId, language, entry) =>
    set((s) => {
      const msgs = s.messagesByThreadId[threadId];
      if (!msgs) return s;
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [threadId]: msgs.map((m) =>
            m.id === messageId ? { ...m, data: { ...m.data, [language]: entry } } : m,
          ),
        },
      };
    }),

  upsertToolCall: (toolCall) =>
    set((s) => {
      const nextToolCallsById = { ...s.toolCallsById, [toolCall.id]: toolCall };

      const nextIdsByMessage = toolCall.messageId
        ? {
            ...s.toolCallIdsByMessageId,
            [toolCall.messageId]: uniqueIds([...(s.toolCallIdsByMessageId[toolCall.messageId] ?? []), toolCall.id]),
          }
        : { ...s.toolCallIdsByMessageId };

      const nextIdsByAssistant = { ...s.toolCallIdsByAssistantMessageId };
      if (toolCall.assistantMessageId) {
        nextIdsByAssistant[toolCall.assistantMessageId] = uniqueIds([
          ...(s.toolCallIdsByAssistantMessageId[toolCall.assistantMessageId] ?? []),
          toolCall.id,
        ]);
      }

      const pendingToolCallIdsByThread = buildPendingByThread(nextToolCallsById);
      const pendingToolCallMessageByThread = buildPendingMessageByThread(nextToolCallsById, pendingToolCallIdsByThread);

      return {
        toolCallsById: nextToolCallsById,
        toolCallIdsByMessageId: nextIdsByMessage,
        toolCallIdsByAssistantMessageId: nextIdsByAssistant,
        toolCallsByMessageId: buildMessageMap(nextToolCallsById),
        pendingToolCallIdsByThread,
        pendingToolCallMessageByThread,
      };
    }),

  patchToolCall: (toolCallId, partial) =>
    set((s) => {
      const existing = s.toolCallsById[toolCallId];
      if (!existing) return s;
      const next = { ...existing, ...partial };
      const nextToolCallsById = { ...s.toolCallsById, [toolCallId]: next };
      const pendingToolCallIdsByThread = buildPendingByThread(nextToolCallsById);
      return {
        toolCallsById: nextToolCallsById,
        toolCallsByMessageId: buildMessageMap(nextToolCallsById),
        pendingToolCallIdsByThread,
        pendingToolCallMessageByThread: buildPendingMessageByThread(nextToolCallsById, pendingToolCallIdsByThread),
      };
    }),

  removeToolCall: (toolCallId) =>
    set((s) => {
      const existing = s.toolCallsById[toolCallId];
      if (!existing) return s;

      const nextToolCallsById = { ...s.toolCallsById };
      delete nextToolCallsById[toolCallId];

      const nextIdsByMessage = { ...s.toolCallIdsByMessageId };
      if (existing.messageId) {
        nextIdsByMessage[existing.messageId] = (nextIdsByMessage[existing.messageId] ?? []).filter((id) => id !== toolCallId);
      }

      const nextIdsByAssistant = { ...s.toolCallIdsByAssistantMessageId };
      if (existing.assistantMessageId) {
        nextIdsByAssistant[existing.assistantMessageId] = (nextIdsByAssistant[existing.assistantMessageId] ?? []).filter(
          (id) => id !== toolCallId,
        );
      }

      const pendingToolCallIdsByThread = buildPendingByThread(nextToolCallsById);
      return {
        toolCallsById: nextToolCallsById,
        toolCallIdsByMessageId: nextIdsByMessage,
        toolCallIdsByAssistantMessageId: nextIdsByAssistant,
        toolCallsByMessageId: buildMessageMap(nextToolCallsById),
        pendingToolCallIdsByThread,
        pendingToolCallMessageByThread: buildPendingMessageByThread(nextToolCallsById, pendingToolCallIdsByThread),
      };
    }),

  upsertToolCalls: (messageId, toolCalls) =>
    set((s) => {
      const nextToolCallsById = { ...s.toolCallsById };
      const ids: string[] = [];
      for (const tc of toolCalls) {
        nextToolCallsById[tc.id] = tc;
        ids.push(tc.id);
      }

      const nextIdsByMessage = { ...s.toolCallIdsByMessageId, [messageId]: uniqueIds(ids) };
      const nextIdsByAssistant = { ...s.toolCallIdsByAssistantMessageId };
      for (const tc of toolCalls) {
        if (!tc.assistantMessageId) continue;
        nextIdsByAssistant[tc.assistantMessageId] = uniqueIds([
          ...(nextIdsByAssistant[tc.assistantMessageId] ?? []),
          tc.id,
        ]);
      }

      const pendingToolCallIdsByThread = buildPendingByThread(nextToolCallsById);
      const pendingToolCallMessageByThread = buildPendingMessageByThread(nextToolCallsById, pendingToolCallIdsByThread);

      return {
        toolCallsById: nextToolCallsById,
        toolCallIdsByMessageId: nextIdsByMessage,
        toolCallIdsByAssistantMessageId: nextIdsByAssistant,
        toolCallsByMessageId: buildMessageMap(nextToolCallsById),
        pendingToolCallIdsByThread,
        pendingToolCallMessageByThread,
      };
    }),

  replaceToolCallsForAssistant: (assistantMessageId, newToolCalls) =>
    set((s) => {
      const nextToolCallsById = { ...s.toolCallsById };
      for (const toolCall of Object.values(nextToolCallsById)) {
        if (!toolCall || toolCall.assistantMessageId !== assistantMessageId) continue;
        delete nextToolCallsById[toolCall.id];
      }
      for (const toolCall of newToolCalls) {
        nextToolCallsById[toolCall.id] = toolCall;
      }
      return buildThreadScopedToolCallState(nextToolCallsById);
    }),

  replaceThreadToolCalls: (threadId, toolCalls) =>
    set((s) => {
      const nextToolCallsById = { ...s.toolCallsById };
      for (const toolCall of Object.values(nextToolCallsById)) {
        if (!toolCall || toolCall.threadId !== threadId) continue;
        delete nextToolCallsById[toolCall.id];
      }
      for (const toolCall of toolCalls) {
        nextToolCallsById[toolCall.id] = toolCall;
      }
      return buildThreadScopedToolCallState(nextToolCallsById);
    }),

  getToolCalls: (messageId) => {
    const state = get();
    const ids = state.toolCallIdsByMessageId[messageId] ?? [];
    return ids
      .map((id) => state.toolCallsById[id])
      .filter((v): v is ThreadToolCall => Boolean(v));
  },

  getToolCallsForAssistantMessage: (assistantMessageId) => {
    const state = get();
    const ids = state.toolCallIdsByAssistantMessageId[assistantMessageId] ?? [];
    return ids
      .map((id) => state.toolCallsById[id])
      .filter((v): v is ThreadToolCall => Boolean(v));
  },

  setPendingToolCallMessage: (threadId, messageId) =>
    set((s) => ({
      pendingToolCallMessageByThread: { ...s.pendingToolCallMessageByThread, [threadId]: messageId },
    })),

  clearPendingToolCallMessage: (threadId) =>
    set((s) => {
      const { [threadId]: _, ...rest } = s.pendingToolCallMessageByThread;
      return { pendingToolCallMessageByThread: rest };
    }),

  setThreadStreamActive: (threadId, active) =>
    set((s) => {
      if (s.activeStreamByThread[threadId] === active) return s;
      return {
        activeStreamByThread: { ...s.activeStreamByThread, [threadId]: active },
      };
    }),

  isThreadStreamActive: (threadId) => Boolean(get().activeStreamByThread[threadId]),

  clearThreadStreamingState: (threadId) =>
    set((s) => {
      const messages = s.messagesByThreadId[threadId] ?? [];
      let changed = false;
      const nextMessages = messages.map((message) => {
        if (!message.isStreaming && message.streamingData === undefined) {
          return message;
        }
        changed = true;
        return {
          ...message,
          isStreaming: false,
          streamingData: undefined,
        };
      });

      const streamActive = Boolean(s.activeStreamByThread[threadId]);
      if (!changed && !streamActive) return s;

      return {
        messagesByThreadId: changed
          ? { ...s.messagesByThreadId, [threadId]: nextMessages }
          : s.messagesByThreadId,
        activeStreamByThread: {
          ...s.activeStreamByThread,
          [threadId]: false,
        },
      };
    }),

  findThreadByParent: (projectId, parentId) => {
    for (const thread of Object.values(get().threadsById)) {
      if (!thread) continue;
      if (thread.projectId === projectId && thread.parentId === parentId) return thread;
    }
    return undefined;
  },

  clearAll: () =>
    set({
      threadsById: {},
      messagesByThreadId: {},
      preexistingLiveThreadsById: {},
      toolCallsById: {},
      toolCallIdsByMessageId: {},
      toolCallIdsByAssistantMessageId: {},
      toolCallsByMessageId: {},
      pendingToolCallIdsByThread: {},
      pendingToolCallMessageByThread: {},
      activeStreamByThread: {},
    }),
}));

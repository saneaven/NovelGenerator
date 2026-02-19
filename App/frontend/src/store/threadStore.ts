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

interface ThreadState {
  threadsById: Record<string, ThreadInfo | undefined>;
  messagesByThreadId: Record<string, ThreadMessage[] | undefined>;

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
  getThread: (threadId: string) => ThreadInfo | undefined;

  upsertMessage: (message: ThreadMessage) => void;
  finalizeMessageFromEnd: (params: FinalizeMessageFromEndParams) => void;
  appendMessage: (message: ThreadMessage) => void;
  patchMessage: (threadId: string, messageId: string, partial: Partial<ThreadMessage>) => void;
  removeMessage: (threadId: string, messageId: string) => void;
  getMessages: (threadId: string) => ThreadMessage[];
  updateMessageData: (
    threadId: string,
    messageId: string,
    language: string,
    entry: ThreadMessage['data'][string],
  ) => void;

  addMessageTranslation: (
    threadId: string,
    messageId: string,
    language: string,
    entry: ThreadMessage['data'][string],
  ) => void;
  clearMessageTranslations: (
    threadId: string,
    messageId: string,
    preserveLanguages: string[],
  ) => void;

  upsertToolCall: (toolCall: ThreadToolCall) => void;
  patchToolCall: (toolCallId: string, partial: Partial<ThreadToolCall>) => void;
  removeToolCall: (toolCallId: string) => void;

  upsertToolCalls: (messageId: string, toolCalls: ThreadToolCall[]) => void;
  getToolCalls: (messageId: string) => ThreadToolCall[];
  getToolCallsForAssistantMessage: (assistantMessageId: string) => ThreadToolCall[];

  setPendingToolCallMessage: (threadId: string, messageId: string) => void;
  clearPendingToolCallMessage: (threadId: string) => void;

  setThreadStreamActive: (threadId: string, active: boolean) => void;
  isThreadStreamActive: (threadId: string) => boolean;

  findThreadByOwner: (projectId: string, ownerId: string) => ThreadInfo | undefined;

  clearAll: () => void;
}

function sortMessages(messages: ThreadMessage[]): ThreadMessage[] {
  return [...messages].sort((a, b) => a.seqInThread - b.seqInThread);
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values)];
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
  if (!message?.streamingData?.contentParts || message.streamingData.contentParts.length === 0) return undefined;
  const preferLanguage = Object.keys(message.data ?? {}).find((key) => key !== '_final') ?? 'English';
  const entry = {
    contentParts: message.streamingData.contentParts,
    thinkingDetails: message.streamingData.thinkingDetails ?? [],
  };
  return {
    ...(message.data ?? {}),
    [preferLanguage]: entry,
    _final: entry,
  };
}

export const useThreadStore = create<ThreadState>()((set, get) => ({
  threadsById: {},
  messagesByThreadId: {},

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
      return {
        threadsById: { ...s.threadsById, [thread.id]: existing ? { ...existing, ...thread } : thread },
      };
    }),

  upsertThreadsRuntime: (threads) =>
    set((s) => {
      if (threads.length === 0) return s;
      const nextThreads = { ...s.threadsById };
      for (const thread of threads) {
        const existing = nextThreads[thread.id];
        nextThreads[thread.id] = existing ? { ...existing, ...thread } : thread;
      }
      return { threadsById: nextThreads };
    }),

  setThreadRuntime: (threadId, partial) =>
    set((s) => {
      const existing = s.threadsById[threadId];
      if (!existing) return s;
      return {
        threadsById: { ...s.threadsById, [threadId]: { ...existing, ...partial } },
      };
    }),

  patchThread: (threadId, partial) =>
    set((s) => {
      const existing = s.threadsById[threadId];
      if (!existing) return s;
      return {
        threadsById: { ...s.threadsById, [threadId]: { ...existing, ...partial } },
      };
    }),

  removeThread: (threadId) =>
    set((s) => {
      const { [threadId]: _, ...rest } = s.threadsById;
      const { [threadId]: __, ...restMsgs } = s.messagesByThreadId;
      return { threadsById: rest, messagesByThreadId: restMsgs };
    }),

  getThread: (threadId) => get().threadsById[threadId],

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

      const merged = existing.map((m) => (m.id === message.id ? { ...m, ...message } : m));
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [message.threadId]: sortMessages(merged),
        },
      };
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
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [threadId]: msgs.filter((m) => m.id !== messageId),
        },
      };
    }),

  getMessages: (threadId) => get().messagesByThreadId[threadId] ?? [],

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

  addMessageTranslation: (threadId, messageId, language, entry) =>
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

  clearMessageTranslations: (threadId, messageId, preserveLanguages) =>
    set((s) => {
      const msgs = s.messagesByThreadId[threadId];
      if (!msgs) return s;
      const preserveSet = new Set(preserveLanguages);
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [threadId]: msgs.map((m) => {
            if (m.id !== messageId) return m;
            const filtered: typeof m.data = {};
            for (const [lang, entry] of Object.entries(m.data)) {
              if (preserveSet.has(lang)) filtered[lang] = entry;
            }
            return { ...m, data: filtered };
          }),
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
    set((s) => ({
      activeStreamByThread: { ...s.activeStreamByThread, [threadId]: active },
    })),

  isThreadStreamActive: (threadId) => Boolean(get().activeStreamByThread[threadId]),

  findThreadByOwner: (projectId, ownerId) => {
    for (const thread of Object.values(get().threadsById)) {
      if (!thread) continue;
      if (thread.projectId === projectId && thread.ownerId === ownerId) return thread;
    }
    return undefined;
  },

  clearAll: () =>
    set({
      threadsById: {},
      messagesByThreadId: {},
      toolCallsById: {},
      toolCallIdsByMessageId: {},
      toolCallIdsByAssistantMessageId: {},
      toolCallsByMessageId: {},
      pendingToolCallIdsByThread: {},
      pendingToolCallMessageByThread: {},
      activeStreamByThread: {},
    }),
}));

/**
 * Thread-centric Zustand store.
 * State is keyed by threadId — no run IDs exposed to UI components.
 */

import { create } from 'zustand';
import type {
  ThreadInfo,
  ThreadMessage,
  ThreadToolCall,
} from '../types/thread';

export type { ThreadInfo, ThreadMessage, ThreadToolCall };
export type { ThreadType, ThreadStatus } from '../types/thread';

interface ThreadState {
  threadsById: Record<string, ThreadInfo | undefined>;
  messagesByThreadId: Record<string, ThreadMessage[] | undefined>;
  toolCallsByMessageId: Record<string, ThreadToolCall[] | undefined>;
  pendingToolCallMessageByThread: Record<string, string | undefined>;
  activeStreamByThread: Record<string, boolean | undefined>;

  upsertThread: (thread: ThreadInfo) => void;
  patchThread: (threadId: string, partial: Partial<ThreadInfo>) => void;
  removeThread: (threadId: string) => void;
  getThread: (threadId: string) => ThreadInfo | undefined;

  replaceMessages: (threadId: string, messages: ThreadMessage[]) => void;
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

  upsertToolCalls: (messageId: string, toolCalls: ThreadToolCall[]) => void;
  getToolCalls: (messageId: string) => ThreadToolCall[];

  setPendingToolCallMessage: (threadId: string, messageId: string) => void;
  clearPendingToolCallMessage: (threadId: string) => void;

  setThreadStreamActive: (threadId: string, active: boolean) => void;
  isThreadStreamActive: (threadId: string) => boolean;

  findThreadByOwner: (projectId: string, ownerId: string) => ThreadInfo | undefined;

  clearAll: () => void;
}

export const useThreadStore = create<ThreadState>()((set, get) => ({
  threadsById: {},
  messagesByThreadId: {},
  toolCallsByMessageId: {},
  pendingToolCallMessageByThread: {},
  activeStreamByThread: {},

  upsertThread: (thread) =>
    set((s) => ({
      threadsById: { ...s.threadsById, [thread.id]: thread },
    })),

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

  replaceMessages: (threadId, messages) =>
    set((s) => ({
      messagesByThreadId: { ...s.messagesByThreadId, [threadId]: messages },
    })),

  appendMessage: (message) =>
    set((s) => {
      const existing = s.messagesByThreadId[message.threadId] ?? [];
      return {
        messagesByThreadId: {
          ...s.messagesByThreadId,
          [message.threadId]: [...existing, message],
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

  upsertToolCalls: (messageId, toolCalls) =>
    set((s) => ({
      toolCallsByMessageId: { ...s.toolCallsByMessageId, [messageId]: toolCalls },
    })),

  getToolCalls: (messageId) => get().toolCallsByMessageId[messageId] ?? [],

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

  clearAll: () => set({
    threadsById: {},
    messagesByThreadId: {},
    toolCallsByMessageId: {},
    pendingToolCallMessageByThread: {},
    activeStreamByThread: {},
  }),
}));

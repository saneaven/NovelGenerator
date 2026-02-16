/**
 * Thread-centric Zustand store.
 *
 * Replaces the run-centric runtimeStore.ts.
 * State is keyed by threadId — no run IDs exposed to UI components.
 */

import { create } from 'zustand';

// ── Types ──

export type ThreadType = 'agent' | 'subAgent' | 'journey';
export type ThreadStatus = 'idle' | 'running' | 'waiting_tools' | 'paused' | 'error';

export interface ThreadInfo {
  id: string;
  projectId: string;
  threadType: ThreadType;
  ownerId?: string | null;
  journeyKind?: string | null;
  status: ThreadStatus;
  lastError?: string | null;
}

export interface ThreadMessage {
  id: string;
  threadId: string;
  seq: number;
  seqInThread: number | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  data: Record<string, { contentParts: Array<{ type: string; text: string }>; thinkingDetails?: Array<Record<string, unknown>> }>;
  createdAt: string;
}

export interface ThreadToolCall {
  id: string;
  threadId: string;
  messageId: string;
  callSeq: number;
  llmCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  status: 'pending' | 'running' | 'accepted' | 'rejected' | 'cancelled';
  reason?: string | null;
  result?: Record<string, unknown> | null;
  childThreadId?: string | null;
  acceptedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Store shape ──

interface ThreadState {
  threadsById: Record<string, ThreadInfo | undefined>;
  messagesByThreadId: Record<string, ThreadMessage[] | undefined>;
  toolCallsByMessageId: Record<string, ThreadToolCall[] | undefined>;
  /** Maps threadId → messageId for messages expecting tool calls (between llm_final and tool_calls events). */
  pendingToolCallMessageByThread: Record<string, string | undefined>;
  activeStreamByThread: Record<string, boolean | undefined>;

  // Actions — threads
  upsertThread: (thread: ThreadInfo) => void;
  patchThread: (threadId: string, partial: Partial<ThreadInfo>) => void;
  removeThread: (threadId: string) => void;
  getThread: (threadId: string) => ThreadInfo | undefined;

  // Actions — messages
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

  // Actions — tool calls
  upsertToolCalls: (messageId: string, toolCalls: ThreadToolCall[]) => void;
  getToolCalls: (messageId: string) => ThreadToolCall[];

  // Actions — pending tool call tracking
  setPendingToolCallMessage: (threadId: string, messageId: string) => void;
  clearPendingToolCallMessage: (threadId: string) => void;

  // Actions — stream tracking
  setThreadStreamActive: (threadId: string, active: boolean) => void;
  isThreadStreamActive: (threadId: string) => boolean;

  // Lookups
  findThreadByOwner: (projectId: string, ownerId: string) => ThreadInfo | undefined;

  // Actions — bulk
  clearAll: () => void;
}

export const useThreadStore = create<ThreadState>()((set, get) => ({
  threadsById: {},
  messagesByThreadId: {},
  toolCallsByMessageId: {},
  pendingToolCallMessageByThread: {},
  activeStreamByThread: {},

  // ── Thread actions ──

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

  // ── Message actions ──

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

  // ── Tool call actions ──

  upsertToolCalls: (messageId, toolCalls) =>
    set((s) => ({
      toolCallsByMessageId: { ...s.toolCallsByMessageId, [messageId]: toolCalls },
    })),

  getToolCalls: (messageId) => get().toolCallsByMessageId[messageId] ?? [],

  // ── Pending tool call tracking ──

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

  // ── Lookups ──

  findThreadByOwner: (projectId, ownerId) => {
    for (const thread of Object.values(get().threadsById)) {
      if (!thread) continue;
      if (thread.projectId === projectId && thread.ownerId === ownerId) return thread;
    }
    return undefined;
  },

  // ── Bulk ──

  clearAll: () => set({
    threadsById: {},
    messagesByThreadId: {},
    toolCallsByMessageId: {},
    pendingToolCallMessageByThread: {},
    activeStreamByThread: {},
  }),
}));

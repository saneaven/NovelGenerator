import { create } from 'zustand';
import { agentService, type AgentResponse, type AgentMessageResponse } from '../api';
import { type ChatMessage, type ToolCallMetadata, type ContentPart, type Role } from '../llm/requestTypes';
import { type LanguageData } from '../types/multilingual';
import { type ToolCallStatus, type ToolCallFailureType, type ApplicationResult } from '../toolCall/types';

const BACKEND_TOOL_CALL_STATUSES = new Set(['failed', 'pending', 'rejected', 'accepted']);

function canSyncToolCalls(toolCalls?: ToolCallMetadata[] | null): boolean {
  if (!Array.isArray(toolCalls)) return true;
  return toolCalls.every((tc) => {
    const status = (tc as any)?.status;
    if (status == null) return true;
    return BACKEND_TOOL_CALL_STATUSES.has(String(status));
  });
}

// Language-specific content for agent messages
export interface MessageContentData {
  contentParts: ContentPart[];
  thinking_details?: any[];
}

// Extended agent message with language support (for storage)
export interface StoredAgentMessage extends Omit<ChatMessage, 'contentParts'> {
  data: LanguageData<MessageContentData>; // Language-specific content
}

export interface Agent {
  id: string;
  name: string;
  messages: StoredAgentMessage[];
  project_id: string;
  archived_until_message_id?: string | null;
  created_at: string;
  updated_at: string;
}

export function getAgentLastActivityAt(agent: Agent): Date {
  const lastMessage = agent.messages?.[agent.messages.length - 1];
  const lastTimestamp = lastMessage?.timestamp instanceof Date
    ? lastMessage.timestamp
    : lastMessage?.timestamp
      ? new Date(lastMessage.timestamp as any)
      : null;

  if (lastTimestamp && !Number.isNaN(lastTimestamp.getTime())) return lastTimestamp;

  const createdAt = new Date(agent.created_at);
  if (!Number.isNaN(createdAt.getTime())) return createdAt;

  return new Date(0);
}

function sortAgentsByLastActivity(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    const aLast = getAgentLastActivityAt(a).getTime();
    const bLast = getAgentLastActivityAt(b).getTime();
    if (aLast !== bLast) return bLast - aLast;

    const aCreated = new Date(a.created_at).getTime();
    const bCreated = new Date(b.created_at).getTime();
    if (aCreated !== bCreated) return bCreated - aCreated;

    return a.id.localeCompare(b.id);
  });
}

interface AgentStore {
  agentsByProject: Record<string, Agent[]>; // projectId -> Agent[]
  selectedAgentByProject: Record<string, string | undefined>; // projectId -> agentId
  isLoading: boolean;
  error: string | null;

  // Core agent management
  fetchAgents: (projectId: string) => Promise<void>;
  createAgent: (projectId: string, name?: string) => Promise<string>;
  getAgents: (projectId: string) => Agent[];
  getAgent: (projectId: string, agentId: string) => Agent | undefined;
  selectAgent: (projectId: string, agentId: string) => void;
  getSelectedAgentId: (projectId: string) => string | undefined;
  getSelectedAgent: (projectId: string) => Agent | undefined;
  renameAgent: (projectId: string, agentId: string, name: string) => Promise<void>;
  deleteAgent: (projectId: string, agentId: string) => Promise<void>;
  setArchivedUntilMessageId: (projectId: string, agentId: string, messageId: string | null) => void;

  // Message management
  fetchMessages: (projectId: string, agentId: string) => Promise<void>;
  addMessage: (projectId: string, agentId: string, message: ChatMessage, language: string) => Promise<string>;
  updateMessage: (projectId: string, agentId: string, messageId: string, contentParts: ContentPart[], language: string, thinking_details?: any[]) => Promise<void>;
  updateMessageContentLocal: (projectId: string, agentId: string, messageId: string, contentParts: ContentPart[], language: string, thinking_details?: any[]) => void;
  getMessages: (projectId: string, agentId: string, language: string) => ChatMessage[];
  deleteMessage: (projectId: string, agentId: string, messageId: string) => Promise<void>;

  // Tool call management
  updateMessageToolCalls: (projectId: string, agentId: string, messageId: string, toolCalls: ToolCallMetadata[]) => void;
  updateToolCallStatus: (
    projectId: string,
    agentId: string,
    messageId: string,
    toolCallId: string,
    status: ToolCallStatus,
    options?: {
      result?: ApplicationResult;
      reason?: string;
      failureType?: ToolCallFailureType;
    }
  ) => void;

  // Translation support
  addTranslatedMessage: (
    projectId: string,
    agentId: string,
    messageId: string,
    translatedData: {
      contentParts?: ContentPart[];
      thinking_details?: any[];
    },
    targetLanguage: string
  ) => Promise<void>;
  clearMessageTranslations: (
    projectId: string,
    agentId: string,
    messageId: string,
    preserveLanguages?: string[]
  ) => void;
  getMessageForLanguage: (projectId: string, agentId: string, messageId: string, language: string) => ChatMessage | null;
  hasMessageInLanguage: (projectId: string, agentId: string, messageId: string, language: string) => boolean;

  // Utilities
  convertToDisplayMessage: (storedMessage: StoredAgentMessage, language: string) => ChatMessage;
  clearProject: (projectId: string) => void;
  clearError: () => void;
}

const convertToDisplayMessage = (storedMessage: StoredAgentMessage, language: string): ChatMessage => {
  const languageData = storedMessage.data?.[language];

  // Defensive: Ensure contentParts is always an array
  const contentParts = Array.isArray(languageData?.contentParts) ? languageData.contentParts : [];
  const thinking_details = languageData?.thinking_details;

  // Extract only the ChatMessage fields, excluding the 'data' property
  const { data, ...messageFields } = storedMessage;

  return {
    ...messageFields,
    contentParts,
    thinking_details,
  };
};

// Helper function to convert backend message to stored message
const convertBackendMessage = (message: AgentMessageResponse): StoredAgentMessage => {
  return {
    id: message.id,
    seq: message.seq,
    role: message.role as Role,
    data: message.data,
    toolCalls: message.tool_calls,
    timestamp: new Date(message.created_at),
  };
};

// Helper function to convert backend agent to store agent
const convertBackendAgent = (agent: AgentResponse): Agent => {
  return {
    id: agent.id,
    name: agent.name,
    project_id: agent.project_id,
    archived_until_message_id: (agent as any).archived_until_message_id ?? null,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
    messages: agent.messages.map(convertBackendMessage),
  };
};

export const useAgentStore = create<AgentStore>()((set, get) => ({
  agentsByProject: {},
  selectedAgentByProject: {},
  isLoading: false,
  error: null,

  // Core agent management
  fetchAgents: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const backendAgents = await agentService.listAgents(projectId);
      const unsortedAgents = Array.isArray(backendAgents) ? backendAgents.map(convertBackendAgent) : [];
      const agents = sortAgentsByLastActivity(unsortedAgents);

      // Restore selected agent from localStorage
      const storedAgentId = localStorage.getItem(`selectedAgent_${projectId}`);
      const validStoredAgentId = storedAgentId && agents.some(agent => agent.id === storedAgentId)
        ? storedAgentId
        : undefined;

      // Clean up invalid stored agent ID
      if (storedAgentId && !validStoredAgentId) {
        localStorage.removeItem(`selectedAgent_${projectId}`);
      }

      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectId]: agents,
        },
        // Only set selectedAgentByProject if we have a valid stored agent
        ...(validStoredAgentId && {
          selectedAgentByProject: {
            ...state.selectedAgentByProject,
            [projectId]: validStoredAgentId,
          },
        }),
        isLoading: false,
      }));

      // Auto-initialize: create agent if none exist, or select first if none selected
      if (agents.length === 0) {
        await get().createAgent(projectId, 'Main Agent');
      } else if (!validStoredAgentId) {
        get().selectAgent(projectId, agents[0].id);
      }
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch agents',
      });
    }
  },

  createAgent: async (projectId: string, name?: string) => {
    set({ isLoading: true, error: null });
    try {
      const agentName = name || `Agent ${(get().agentsByProject[projectId] || []).length + 1}`;
      const backendAgent = await agentService.createAgent(projectId, { name: agentName });
      const agent = convertBackendAgent(backendAgent);

      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectId]: sortAgentsByLastActivity([...(state.agentsByProject[projectId] || []), agent]),
        },
        selectedAgentByProject: {
          ...state.selectedAgentByProject,
          [projectId]: agent.id,
        },
        isLoading: false,
      }));

      return agent.id;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create agent',
      });
      throw error;
    }
  },

  getAgents: (projectId: string) => {
    return get().agentsByProject[projectId] || [];
  },

  getAgent: (projectId: string, agentId: string) => {
    const agents = get().agentsByProject[projectId] || [];
    return agents.find((agent) => agent.id === agentId);
  },

  selectAgent: (projectId: string, agentId: string) => {
    set((state) => ({
      selectedAgentByProject: {
        ...state.selectedAgentByProject,
        [projectId]: agentId,
      },
    }));
    // Persist selected agent
    localStorage.setItem(`selectedAgent_${projectId}`, agentId);
  },

  getSelectedAgentId: (projectId: string) => {
    return get().selectedAgentByProject[projectId];
  },

  getSelectedAgent: (projectId: string) => {
    const selectedAgentId = get().getSelectedAgentId(projectId);
    if (selectedAgentId) {
      return get().getAgent(projectId, selectedAgentId);
    }
    return undefined;
  },

  renameAgent: async (projectId: string, agentId: string, name: string) => {
    set({ isLoading: true, error: null });
    try {
      const backendAgent = await agentService.updateAgent(projectId, agentId, { name });
      const agent = convertBackendAgent(backendAgent);

      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectId]:
            state.agentsByProject[projectId]?.map((a) => (a.id === agentId ? agent : a)) || [],
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to rename agent',
      });
      throw error;
    }
  },

  setArchivedUntilMessageId: (projectId: string, agentId: string, messageId: string | null) => {
    set((state) => ({
      agentsByProject: {
        ...state.agentsByProject,
        [projectId]:
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId ? { ...agent, archived_until_message_id: messageId } : agent
          ) || [],
      },
    }));
  },

  deleteAgent: async (projectId: string, agentId: string) => {
    set({ isLoading: true, error: null });
    try {
      await agentService.deleteAgent(projectId, agentId);
      const agents = get().agentsByProject[projectId] || [];
      const filteredAgents = agents.filter((agent) => agent.id !== agentId);

      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectId]: filteredAgents,
        },
        selectedAgentByProject: {
          ...state.selectedAgentByProject,
          [projectId]: filteredAgents.length > 0 ? filteredAgents[0].id : undefined,
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete agent',
      });
      throw error;
    }
  },

  // Message management
  fetchMessages: async (projectId: string, agentId: string) => {
    set({ isLoading: true, error: null });
    try {
      const backendAgent = await agentService.getAgent(projectId, agentId);
      const messages = backendAgent.messages?.map(convertBackendMessage) || [];

      set((state) => {
        const nextAgents =
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId ? { ...agent, messages } : agent
          ) || [];

        return {
          agentsByProject: {
            ...state.agentsByProject,
            [projectId]: sortAgentsByLastActivity(nextAgents),
          },
          isLoading: false,
        };
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch messages',
      });
    }
  },

  addMessage: async (projectId: string, agentId: string, message: ChatMessage, language: string): Promise<string> => {
    set({ isLoading: true, error: null });
    try {
      const payload: any = {
        role: message.role,
        language: language,
        content_parts: message.contentParts,
      };

      if (message.toolCalls) {
        payload.tool_calls = message.toolCalls;
      }

      if (message.thinking_details) {
        payload.thinking_details = message.thinking_details;
      }

      const backendMessage = await agentService.addMessage(projectId, agentId, payload);
      const storedMessage = convertBackendMessage(backendMessage);

      set((state) => {
        const nextAgents =
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId
              ? { ...agent, messages: [...agent.messages, storedMessage] }
              : agent
          ) || [];

        return {
          agentsByProject: {
            ...state.agentsByProject,
            [projectId]: sortAgentsByLastActivity(nextAgents),
          },
          isLoading: false,
        };
      });

      return storedMessage.id;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to add message',
      });
      throw error;
    }
  },

  updateMessage: async (projectId: string, agentId: string, messageId: string, contentParts: ContentPart[], language: string, thinking_details?: any[]) => {
    set({ isLoading: true, error: null });
    try {
      const payload: any = {
        language: language,
      };

      // NEW: Send contentParts
      if (contentParts && contentParts.length > 0) {
        payload.content_parts = contentParts;
      }

      // Include thinking_details metadata if provided
      if (thinking_details !== undefined) {
        payload.thinking_details = thinking_details;
      }

      const backendMessage = await agentService.updateMessage(projectId, agentId, messageId, payload);
      const storedMessage = convertBackendMessage(backendMessage);

      set((state) => ({
        agentsByProject: {
          ...state.agentsByProject,
          [projectId]:
            state.agentsByProject[projectId]?.map((agent) =>
              agent.id === agentId
                ? {
                    ...agent,
                    messages: agent.messages.map((msg) =>
                      msg.id === messageId ? storedMessage : msg
                    ),
                  }
                : agent
            ) || [],
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to update message',
      });
      throw error;
    }
  },

  updateMessageContentLocal: (
    projectId: string,
    agentId: string,
    messageId: string,
    contentParts: ContentPart[],
    language: string,
    thinking_details?: any[]
  ) => {
    set((state) => ({
      agentsByProject: {
        ...state.agentsByProject,
        [projectId]:
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId
              ? {
                  ...agent,
                  messages: agent.messages.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          data: {
                            ...msg.data,
                            [language]: {
                              contentParts,
                              thinking_details
                            }
                          }
                        }
                      : msg
                  ),
                }
              : agent
          ) || [],
      },
    }));
  },

  getMessages: (projectId: string, agentId: string, language: string) => {
    const agent = get().getAgent(projectId, agentId);
    if (!agent) return [];

    const sorted = [...agent.messages].sort((a, b) => {
      const aSeq = a.seq ?? 0;
      const bSeq = b.seq ?? 0;
      if (aSeq !== bSeq) return aSeq - bSeq;
      return a.timestamp.getTime() - b.timestamp.getTime();
    });

    return sorted.map((msg) => convertToDisplayMessage(msg, language));
  },

  deleteMessage: async (projectId: string, agentId: string, messageId: string) => {
    set({ isLoading: true, error: null });
    try {
      await agentService.deleteMessage(projectId, agentId, messageId);

      set((state) => {
        const nextAgents =
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId
              ? {
                  ...agent,
                  messages: agent.messages.filter((msg) => msg.id !== messageId),
                }
              : agent
          ) || [];

        return {
          agentsByProject: {
            ...state.agentsByProject,
            [projectId]: sortAgentsByLastActivity(nextAgents),
          },
          isLoading: false,
        };
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete message',
      });
      throw error;
    }
  },

  // Tool call management - syncs to backend
  updateMessageToolCalls: async (projectId: string, agentId: string, messageId: string, toolCalls: ToolCallMetadata[]) => {
    // Update local state first for immediate UI response
    set((state) => ({
      agentsByProject: {
        ...state.agentsByProject,
        [projectId]:
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId
              ? {
                  ...agent,
                  messages: agent.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, toolCalls } : msg
                  ),
                }
              : agent
          ) || [],
      },
    }));

    if (!canSyncToolCalls(toolCalls)) return;

    // Sync to backend
    try {
      const agent = get().getAgent(projectId, agentId);
      const message = agent?.messages.find((msg) => msg.id === messageId);
      if (!message) return;

      // Get the primary language content for this message
      const primaryLanguage = Object.keys(message.data)[0] || 'English';
      const contentParts = message.data[primaryLanguage]?.contentParts;

      await agentService.updateMessage(projectId, agentId, messageId, {
        content_parts: contentParts,
        language: primaryLanguage,
        tool_calls: toolCalls,
      });
    } catch (error) {
      console.error('Failed to sync tool calls to backend:', error);
    }
  },

  updateToolCallStatus: async (
    projectId: string,
    agentId: string,
    messageId: string,
    toolCallId: string,
    status: ToolCallStatus,
    options?: {
      result?: ApplicationResult;
      reason?: string;
      failureType?: ToolCallFailureType;
    }
  ) => {
    // Update local state first for immediate UI response
    set((state) => ({
      agentsByProject: {
        ...state.agentsByProject,
        [projectId]:
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId
              ? {
                  ...agent,
                  messages: agent.messages.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          toolCalls: msg.toolCalls?.map((tc) =>
                            tc.id === toolCallId
                              ? {
                                  ...tc,
                                  status,
                                  reason: options?.reason,
                                  failureType: options?.failureType,
                                  result: options?.result,
                                  acceptedAt: status === 'accepted' ? new Date() : undefined,
                                }
                              : tc
                          ),
                        }
                      : msg
                  ),
                }
              : agent
          ) || [],
      },
    }));

    // Sync to backend
    try {
      const agent = get().getAgent(projectId, agentId);
      const message = agent?.messages.find((msg) => msg.id === messageId);
      if (!message || !message.toolCalls) return;

      if (!canSyncToolCalls(message.toolCalls)) return;

      // Get the primary language content for this message
      const primaryLanguage = Object.keys(message.data)[0] || 'English';
      const contentParts = message.data[primaryLanguage]?.contentParts;

      await agentService.updateMessage(projectId, agentId, messageId, {
        content_parts: contentParts,
        language: primaryLanguage,
        tool_calls: message.toolCalls,
      });
    } catch (error) {
      console.error('Failed to sync tool call status to backend:', error);
    }
  },

  // Translation support - syncs to backend
  addTranslatedMessage: async (
    projectId: string,
    agentId: string,
    messageId: string,
    translatedData: {
      contentParts?: ContentPart[];
      thinking_details?: any[];
    },
    targetLanguage: string
  ) => {
    // 1. Update local state first (optimistic update for immediate UI response)
    set((state) => ({
      agentsByProject: {
        ...state.agentsByProject,
        [projectId]:
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId
              ? {
                  ...agent,
                  messages: agent.messages.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          data: {
                            ...msg.data,
                            [targetLanguage]: {
                              contentParts: translatedData.contentParts || [],
                              thinking_details: translatedData.thinking_details
                            },
                          },
                        }
                      : msg
                  ),
                }
              : agent
        ) || [],
      },
    }));

    // 2. Sync to backend
    try {
      await agentService.updateMessage(projectId, agentId, messageId, {
        content_parts: translatedData.contentParts,
        language: targetLanguage,
        thinking_details: translatedData.thinking_details,
      });
    } catch (error) {
      console.error('Failed to persist translation to backend:', error);
    }
  },

  clearMessageTranslations: (
    projectId: string,
    agentId: string,
    messageId: string,
    preserveLanguages: string[] = []
  ) => {
    const preserveSet = new Set(preserveLanguages);

    set((state) => ({
      agentsByProject: {
        ...state.agentsByProject,
        [projectId]:
          state.agentsByProject[projectId]?.map((agent) =>
            agent.id === agentId
              ? {
                  ...agent,
                  messages: agent.messages.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          data: Object.entries(msg.data || {}).reduce((acc, [lang, data]) => {
                            if (preserveSet.size === 0 || preserveSet.has(lang)) {
                              acc[lang] = data;
                            }
                            return acc;
                          }, {} as LanguageData<MessageContentData>),
                        }
                      : msg
                  ),
                }
              : agent
          ) || [],
      },
    }));
  },

  getMessageForLanguage: (projectId: string, agentId: string, messageId: string, language: string) => {
    const agent = get().getAgent(projectId, agentId);
    if (!agent) return null;

    const storedMessage = agent.messages.find((msg) => msg.id === messageId);
    if (!storedMessage || !storedMessage.data[language]) return null;

    return convertToDisplayMessage(storedMessage, language);
  },

  hasMessageInLanguage: (projectId: string, agentId: string, messageId: string, language: string) => {
    const agent = get().getAgent(projectId, agentId);
    if (!agent) return false;

    const storedMessage = agent.messages.find((msg) => msg.id === messageId);
    return storedMessage ? language in storedMessage.data : false;
  },

  // Utilities
  convertToDisplayMessage,

  clearProject: (projectId: string) => {
    set((state) => ({
      agentsByProject: {
        ...state.agentsByProject,
        [projectId]: [],
      },
      selectedAgentByProject: {
        ...state.selectedAgentByProject,
        [projectId]: undefined,
      },
    }));
  },

  clearError: () => {
    set({ error: null });
  },
}));

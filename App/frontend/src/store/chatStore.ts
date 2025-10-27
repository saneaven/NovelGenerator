import { create } from 'zustand';
import { chatService, type ChatResponse, type ChatMessageResponse } from '../api';
import { type ChatMessage, type FunctionCallMetadata, type ContentPart } from '../llm_request/types';
import { type LanguageData } from '../types/multilingual';

// Language-specific content for chat messages
export interface MessageContentData {
  contentParts: ContentPart[];
  reasoning_details?: any[];
}

// Extended chat message with language support (for storage)
export interface StoredChatMessage extends Omit<ChatMessage, 'content'> {
  data: LanguageData<MessageContentData>; // Language-specific content
}

export interface Chat {
  id: string;
  name: string;
  messages: StoredChatMessage[];
  project_id: string;
  created_at: string;
  updated_at: string;
}

interface ChatStore {
  chatsByProject: Record<string, Chat[]>; // projectId -> Chat[]
  selectedChatByProject: Record<string, string | undefined>; // projectId -> chatId
  isLoading: boolean;
  error: string | null;

  // Core chat management
  fetchChats: (projectId: string) => Promise<void>;
  createChat: (projectId: string, name?: string) => Promise<string>;
  getChats: (projectId: string) => Chat[];
  getChat: (projectId: string, chatId: string) => Chat | undefined;
  selectChat: (projectId: string, chatId: string) => void;
  getSelectedChatId: (projectId: string) => string | undefined;
  getSelectedChat: (projectId: string) => Chat | undefined;
  renameChat: (projectId: string, chatId: string, name: string) => Promise<void>;
  deleteChat: (projectId: string, chatId: string) => Promise<void>;

  // Message management
  fetchMessages: (projectId: string, chatId: string) => Promise<void>;
  addMessage: (projectId: string, chatId: string, message: ChatMessage, language: string) => Promise<string>;
  updateMessage: (projectId: string, chatId: string, messageId: string, contentParts: ContentPart[], language: string, reasoning_details?: any[]) => Promise<void>;
  updateMessageContentLocal: (projectId: string, chatId: string, messageId: string, contentParts: ContentPart[], language: string, reasoning_details?: any[]) => void;
  getMessages: (projectId: string, chatId: string, language: string) => ChatMessage[];
  deleteMessage: (projectId: string, chatId: string, messageId: string) => Promise<void>;

  // Function call management
  updateMessageFunctionCalls: (projectId: string, chatId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  updateFunctionCallStatus: (projectId: string, chatId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string, resultMessage?: string) => void;

  // Translation support
  addTranslatedMessage: (
    projectId: string,
    chatId: string,
    messageId: string,
    translatedData: {
      contentParts?: ContentPart[];
      reasoning_details?: any[];
    },
    targetLanguage: string
  ) => void;
  getMessageForLanguage: (projectId: string, chatId: string, messageId: string, language: string) => ChatMessage | null;
  hasMessageInLanguage: (projectId: string, chatId: string, messageId: string, language: string) => boolean;

  // Utilities
  convertToDisplayMessage: (storedMessage: StoredChatMessage, language: string) => ChatMessage;
  clearProject: (projectId: string) => void;
  clearError: () => void;
}

const convertToDisplayMessage = (storedMessage: StoredChatMessage, language: string): ChatMessage => {
  const languageData = storedMessage.data?.[language];

  // Defensive: Ensure contentParts is always an array
  const contentParts = Array.isArray(languageData?.contentParts) ? languageData.contentParts : [];
  const reasoning_details = languageData?.reasoning_details;

  // Ensure content is always a string, never undefined or object
  let content = '';
  try {
    content = contentParts
      .filter(p => p && p.type === 'content' && typeof p.text === 'string')
      .map(p => p.text)
      .join('');
  } catch (error) {
    console.error('Error extracting content from contentParts:', error);
    content = '';
  }

  return {
    ...storedMessage,
    content: content, // Explicitly set to ensure it's a string
    contentParts,
    reasoning_details,
    data: undefined,
  };
};

// Helper function to convert backend message to stored message
const convertBackendMessage = (message: ChatMessageResponse): StoredChatMessage => {
  return {
    id: message.id,
    role: message.role,
    data: message.data,
    functionCalls: message.function_calls,
    timestamp: new Date(message.created_at),
  };
};

// Helper function to convert backend chat to store chat
const convertBackendChat = (chat: ChatResponse): Chat => {
  return {
    id: chat.id,
    name: chat.name,
    project_id: chat.project_id,
    created_at: chat.created_at,
    updated_at: chat.updated_at,
    messages: chat.messages.map(convertBackendMessage),
  };
};

export const useChatStore = create<ChatStore>()((set, get) => ({
  chatsByProject: {},
  selectedChatByProject: {},
  isLoading: false,
  error: null,

  // Core chat management
  fetchChats: async (projectId: string) => {
    set({ isLoading: true, error: null });
    try {
      const backendChats = await chatService.listChats(projectId);
      const chats = Array.isArray(backendChats) ? backendChats.map(convertBackendChat) : [];

      set((state) => ({
        chatsByProject: {
          ...state.chatsByProject,
          [projectId]: chats,
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch chats',
      });
    }
  },

  createChat: async (projectId: string, name?: string) => {
    set({ isLoading: true, error: null });
    try {
      const chatName = name || `Chat ${(get().chatsByProject[projectId] || []).length + 1}`;
      const backendChat = await chatService.createChat(projectId, { name: chatName });
      const chat = convertBackendChat(backendChat);

      set((state) => ({
        chatsByProject: {
          ...state.chatsByProject,
          [projectId]: [...(state.chatsByProject[projectId] || []), chat],
        },
        selectedChatByProject: {
          ...state.selectedChatByProject,
          [projectId]: chat.id,
        },
        isLoading: false,
      }));

      return chat.id;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to create chat',
      });
      throw error;
    }
  },

  getChats: (projectId: string) => {
    return get().chatsByProject[projectId] || [];
  },

  getChat: (projectId: string, chatId: string) => {
    const chats = get().chatsByProject[projectId] || [];
    return chats.find((chat) => chat.id === chatId);
  },

  selectChat: (projectId: string, chatId: string) => {
    set((state) => ({
      selectedChatByProject: {
        ...state.selectedChatByProject,
        [projectId]: chatId,
      },
    }));
    // Persist selected chat
    localStorage.setItem(`selectedChat_${projectId}`, chatId);
  },

  getSelectedChatId: (projectId: string) => {
    return get().selectedChatByProject[projectId];
  },

  getSelectedChat: (projectId: string) => {
    const selectedChatId = get().getSelectedChatId(projectId);
    if (selectedChatId) {
      return get().getChat(projectId, selectedChatId);
    }
    return undefined;
  },

  renameChat: async (projectId: string, chatId: string, name: string) => {
    set({ isLoading: true, error: null });
    try {
      const backendChat = await chatService.updateChat(projectId, chatId, { name });
      const chat = convertBackendChat(backendChat);

      set((state) => ({
        chatsByProject: {
          ...state.chatsByProject,
          [projectId]:
            state.chatsByProject[projectId]?.map((c) => (c.id === chatId ? chat : c)) || [],
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to rename chat',
      });
      throw error;
    }
  },

  deleteChat: async (projectId: string, chatId: string) => {
    set({ isLoading: true, error: null });
    try {
      await chatService.deleteChat(projectId, chatId);
      const chats = get().chatsByProject[projectId] || [];
      const filteredChats = chats.filter((chat) => chat.id !== chatId);

      set((state) => ({
        chatsByProject: {
          ...state.chatsByProject,
          [projectId]: filteredChats,
        },
        selectedChatByProject: {
          ...state.selectedChatByProject,
          [projectId]: filteredChats.length > 0 ? filteredChats[0].id : undefined,
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete chat',
      });
      throw error;
    }
  },

  // Message management
  fetchMessages: async (projectId: string, chatId: string) => {
    set({ isLoading: true, error: null });
    try {
      const backendChat = await chatService.getChat(projectId, chatId);
      const messages = backendChat.messages?.map(convertBackendMessage) || [];

      set((state) => ({
        chatsByProject: {
          ...state.chatsByProject,
          [projectId]:
            state.chatsByProject[projectId]?.map((chat) =>
              chat.id === chatId ? { ...chat, messages } : chat
            ) || [],
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch messages',
      });
    }
  },

  addMessage: async (projectId: string, chatId: string, message: ChatMessage, language: string): Promise<string> => {
    set({ isLoading: true, error: null });
    try {
      const payload: any = {
        role: message.role,
        language: language,
      };

      if (message.contentParts) {
        payload.content_parts = message.contentParts;
      } else if (message.content !== undefined && message.content !== null) {
        // Always send content_parts even if content is empty string
        payload.content_parts = [{type: 'content', text: message.content}];
      }

      if (message.functionCalls) {
        payload.function_calls = message.functionCalls;
      }

      if (message.reasoning_details) {
        payload.reasoning_details = message.reasoning_details;
      }

      const backendMessage = await chatService.addMessage(projectId, chatId, payload);
      const storedMessage = convertBackendMessage(backendMessage);

      set((state) => ({
        chatsByProject: {
          ...state.chatsByProject,
          [projectId]:
            state.chatsByProject[projectId]?.map((chat) =>
              chat.id === chatId
                ? { ...chat, messages: [...chat.messages, storedMessage] }
                : chat
            ) || [],
        },
        isLoading: false,
      }));

      return storedMessage.id;
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to add message',
      });
      throw error;
    }
  },

  updateMessage: async (projectId: string, chatId: string, messageId: string, contentParts: ContentPart[], language: string, reasoning_details?: any[]) => {
    set({ isLoading: true, error: null });
    try {
      const payload: any = {
        language: language,
      };

      // NEW: Send contentParts
      if (contentParts && contentParts.length > 0) {
        payload.content_parts = contentParts;
      }

      // Include reasoning_details metadata if provided
      if (reasoning_details !== undefined) {
        payload.reasoning_details = reasoning_details;
      }

      const backendMessage = await chatService.updateMessage(projectId, chatId, messageId, payload);
      const storedMessage = convertBackendMessage(backendMessage);

      set((state) => ({
        chatsByProject: {
          ...state.chatsByProject,
          [projectId]:
            state.chatsByProject[projectId]?.map((chat) =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map((msg) =>
                      msg.id === messageId ? storedMessage : msg
                    ),
                  }
                : chat
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
    chatId: string,
    messageId: string,
    contentParts: ContentPart[],
    language: string,
    reasoning_details?: any[]
  ) => {
    set((state) => ({
      chatsByProject: {
        ...state.chatsByProject,
        [projectId]:
          state.chatsByProject[projectId]?.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: chat.messages.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          data: {
                            ...msg.data,
                            [language]: {
                              contentParts,
                              reasoning_details
                            }
                          }
                        }
                      : msg
                  ),
                }
              : chat
          ) || [],
      },
    }));
  },

  getMessages: (projectId: string, chatId: string, language: string) => {
    const chat = get().getChat(projectId, chatId);
    if (!chat) return [];

    return chat.messages.map((msg) => convertToDisplayMessage(msg, language));
  },

  deleteMessage: async (projectId: string, chatId: string, messageId: string) => {
    set({ isLoading: true, error: null });
    try {
      await chatService.deleteMessage(projectId, chatId, messageId);

      set((state) => ({
        chatsByProject: {
          ...state.chatsByProject,
          [projectId]:
            state.chatsByProject[projectId]?.map((chat) =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.filter((msg) => msg.id !== messageId),
                  }
                : chat
            ) || [],
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to delete message',
      });
      throw error;
    }
  },

  // Function call management - syncs to backend
  updateMessageFunctionCalls: async (projectId: string, chatId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => {
    // Update local state first for immediate UI response
    set((state) => ({
      chatsByProject: {
        ...state.chatsByProject,
        [projectId]:
          state.chatsByProject[projectId]?.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: chat.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, functionCalls } : msg
                  ),
                }
              : chat
          ) || [],
      },
    }));

    // Sync to backend
    try {
      const chat = get().getChat(projectId, chatId);
      const message = chat?.messages.find((msg) => msg.id === messageId);
      if (!message) return;

      // Get the primary language content for this message
      const primaryLanguage = Object.keys(message.data)[0] || 'English';
      const contentParts = message.data[primaryLanguage]?.contentParts;

      await chatService.updateMessage(projectId, chatId, messageId, {
        content_parts: contentParts,
        language: primaryLanguage,
        function_calls: functionCalls,
      });
    } catch (error) {
      console.error('Failed to sync function calls to backend:', error);
    }
  },

  updateFunctionCallStatus: async (projectId: string, chatId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string, resultMessage?: string) => {
    // Update local state first for immediate UI response
    set((state) => ({
      chatsByProject: {
        ...state.chatsByProject,
        [projectId]:
          state.chatsByProject[projectId]?.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: chat.messages.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          functionCalls: msg.functionCalls?.map((funcCall) =>
                            funcCall.id === functionCallId
                              ? {
                                  ...funcCall,
                                  isApplied,
                                  result,
                                  error,
                                  resultMessage:
                                    resultMessage ||
                                    (isApplied
                                      ? 'Function call accepted and executed successfully'
                                      : 'Function call was rejected'),
                                  appliedAt: isApplied ? new Date() : undefined,
                                }
                              : funcCall
                          ),
                        }
                      : msg
                  ),
                }
              : chat
          ) || [],
      },
    }));

    // Sync to backend
    try {
      const chat = get().getChat(projectId, chatId);
      const message = chat?.messages.find((msg) => msg.id === messageId);
      if (!message || !message.functionCalls) return;

      // Get the primary language content for this message
      const primaryLanguage = Object.keys(message.data)[0] || 'English';
      const contentParts = message.data[primaryLanguage]?.contentParts;

      await chatService.updateMessage(projectId, chatId, messageId, {
        content_parts: contentParts,
        language: primaryLanguage,
        function_calls: message.functionCalls,
      });
    } catch (error) {
      console.error('Failed to sync function call status to backend:', error);
    }
  },

  // Translation support (local updates - would sync to backend on next message update)
  addTranslatedMessage: (
    projectId: string,
    chatId: string,
    messageId: string,
    translatedData: {
      contentParts?: ContentPart[];
      reasoning_details?: any[];
    },
    targetLanguage: string
  ) => {
    set((state) => ({
      chatsByProject: {
        ...state.chatsByProject,
        [projectId]:
          state.chatsByProject[projectId]?.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: chat.messages.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          data: {
                            ...msg.data,
                            [targetLanguage]: translatedData,
                          },
                        }
                      : msg
                  ),
                }
              : chat
          ) || [],
      },
    }));
  },

  getMessageForLanguage: (projectId: string, chatId: string, messageId: string, language: string) => {
    const chat = get().getChat(projectId, chatId);
    if (!chat) return null;

    const storedMessage = chat.messages.find((msg) => msg.id === messageId);
    if (!storedMessage || !storedMessage.data[language]) return null;

    return convertToDisplayMessage(storedMessage, language);
  },

  hasMessageInLanguage: (projectId: string, chatId: string, messageId: string, language: string) => {
    const chat = get().getChat(projectId, chatId);
    if (!chat) return false;

    const storedMessage = chat.messages.find((msg) => msg.id === messageId);
    return storedMessage ? language in storedMessage.data : false;
  },

  // Utilities
  convertToDisplayMessage,

  clearProject: (projectId: string) => {
    set((state) => ({
      chatsByProject: {
        ...state.chatsByProject,
        [projectId]: [],
      },
      selectedChatByProject: {
        ...state.selectedChatByProject,
        [projectId]: undefined,
      },
    }));
  },

  clearError: () => {
    set({ error: null });
  },
}));

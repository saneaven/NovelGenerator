import { create } from 'zustand';
import { chatService, type ChatResponse, type ChatMessageResponse } from '../api';
import { type ChatMessage, type FunctionCallMetadata } from '../llm_request/types';
import { type LanguageData } from '../types/multilingual';

// Language-specific content for chat messages
export interface MessageContentData {
  content: string;
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
  addMessage: (projectId: string, chatId: string, message: ChatMessage, language: string) => Promise<void>;
  updateMessage: (projectId: string, chatId: string, messageId: string, content: string, language: string) => Promise<void>;
  getMessages: (projectId: string, chatId: string, language: string) => ChatMessage[];
  deleteMessage: (projectId: string, chatId: string, messageId: string) => Promise<void>;

  // Function call management
  updateMessageFunctionCalls: (projectId: string, chatId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  updateFunctionCallStatus: (projectId: string, chatId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string, resultMessage?: string) => void;

  // Translation support
  addTranslatedMessage: (projectId: string, chatId: string, messageId: string, translatedContent: string, targetLanguage: string) => void;
  getMessageForLanguage: (projectId: string, chatId: string, messageId: string, language: string) => ChatMessage | null;
  hasMessageInLanguage: (projectId: string, chatId: string, messageId: string, language: string) => boolean;

  // Utilities
  convertToDisplayMessage: (storedMessage: StoredChatMessage, language: string) => ChatMessage;
  clearProject: (projectId: string) => void;
  clearError: () => void;
}

// Helper function to convert stored message to display message
const convertToDisplayMessage = (storedMessage: StoredChatMessage, language: string): ChatMessage => {
  const languageData = storedMessage.data[language];
  const content = languageData ? languageData.content : (storedMessage as any).content || '';

  return {
    ...storedMessage,
    content,
    data: undefined, // Remove language data from display
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
    messages: chat.messages?.map(convertBackendMessage) || [],
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
        chatsByProject: {},
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

  addMessage: async (projectId: string, chatId: string, message: ChatMessage, language: string) => {
    set({ isLoading: true, error: null });
    try {
      const backendMessage = await chatService.addMessage(projectId, chatId, {
        role: message.role,
        data: { [language]: { content: message.content || '' } },
        function_calls: message.functionCalls,
      });
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
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to add message',
      });
      throw error;
    }
  },

  updateMessage: async (projectId: string, chatId: string, messageId: string, content: string, language: string) => {
    set({ isLoading: true, error: null });
    try {
      // Get current message to preserve other language data
      const chat = get().getChat(projectId, chatId);
      const currentMessage = chat?.messages.find((msg) => msg.id === messageId);
      if (!currentMessage) throw new Error('Message not found');

      const backendMessage = await chatService.updateMessage(projectId, chatId, messageId, {
        data: {
          ...currentMessage.data,
          [language]: { content },
        },
      });
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

  // Function call management (local only for now - would need backend support)
  updateMessageFunctionCalls: (projectId: string, chatId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => {
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
  },

  updateFunctionCallStatus: (projectId: string, chatId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string, resultMessage?: string) => {
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
  },

  // Translation support (local updates - would sync to backend on next message update)
  addTranslatedMessage: (projectId: string, chatId: string, messageId: string, translatedContent: string, targetLanguage: string) => {
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
                            [targetLanguage]: { content: translatedContent },
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

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type ChatMessage, type FunctionCallMetadata } from '../llm_request/types';
import { type LanguageData } from '../types/storyObject';

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
  createdAt: Date;
  updatedAt: Date;
}

interface ChatStore {
  chatsByProject: Record<string, Chat[]>; // projectId -> Chat[]
  selectedChatByProject: Record<string, string | undefined>; // projectId -> chatId

  // Core chat management
  createChat: (projectId: string, name?: string) => string;
  getChats: (projectId: string) => Chat[];
  getChat: (projectId: string, chatId: string) => Chat | undefined;
  selectChat: (projectId: string, chatId: string) => void;
  getSelectedChatId: (projectId: string) => string | undefined;
  getSelectedChat: (projectId: string) => Chat | undefined;
  renameChat: (projectId: string, chatId: string, name: string) => void;
  deleteChat: (projectId: string, chatId: string) => void;

  // Message management
  addMessage: (projectId: string, chatId: string, message: ChatMessage, language: string) => void;
  updateMessage: (projectId: string, chatId: string, messageId: string, content: string, language: string) => void;
  getMessages: (projectId: string, chatId: string, language: string) => ChatMessage[];
  deleteMessage: (projectId: string, chatId: string, messageId: string) => void;

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

// Helper function to create stored message from display message
const createStoredMessage = (message: ChatMessage, language: string): StoredChatMessage => {
  const { content, ...rest } = message;

  return {
    ...rest,
    data: {
      [language]: {
        content: content || '',
      },
    },
  };
};

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      chatsByProject: {},
      selectedChatByProject: {},

      // Core chat management
      createChat: (projectId: string, name?: string) => {
        const chatId = crypto.randomUUID();
        const now = new Date();
        const chats = get().chatsByProject[projectId] || [];
        const chatName = name || `Chat ${chats.length + 1}`;

        const newChat: Chat = {
          id: chatId,
          name: chatName,
          messages: [],
          createdAt: now,
          updatedAt: now
        };

        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: [...chats, newChat]
          },
          selectedChatByProject: {
            ...state.selectedChatByProject,
            [projectId]: chatId
          }
        }));

        return chatId;
      },

      getChats: (projectId: string) => {
        return get().chatsByProject[projectId] || [];
      },

      getChat: (projectId: string, chatId: string) => {
        const chats = get().chatsByProject[projectId] || [];
        return chats.find(chat => chat.id === chatId);
      },

      selectChat: (projectId: string, chatId: string) => {
        set((state) => ({
          selectedChatByProject: {
            ...state.selectedChatByProject,
            [projectId]: chatId
          }
        }));
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

      renameChat: (projectId: string, chatId: string, name: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: state.chatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? { ...chat, name, updatedAt: new Date() }
                : chat
            ) || []
          }
        }));
      },

      deleteChat: (projectId: string, chatId: string) => {
        const state = get();
        const chats = state.chatsByProject[projectId] || [];
        const filteredChats = chats.filter(chat => chat.id !== chatId);

        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: filteredChats
          },
          selectedChatByProject: {
            ...state.selectedChatByProject,
            [projectId]: filteredChats.length > 0 ? filteredChats[0].id : undefined
          }
        }));
      },

      // Message management
      addMessage: (projectId: string, chatId: string, message: ChatMessage, language: string) => {
        const storedMessage = createStoredMessage(message, language);

        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: state.chatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? { ...chat, messages: [...chat.messages, storedMessage], updatedAt: new Date() }
                : chat
            ) || []
          }
        }));
      },

      updateMessage: (projectId: string, chatId: string, messageId: string, content: string, language: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: state.chatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === messageId
                        ? {
                            ...msg,
                            data: {
                              ...msg.data,
                              [language]: { content }
                            }
                          }
                        : msg
                    ),
                    updatedAt: new Date()
                  }
                : chat
            ) || []
          }
        }));
      },

      getMessages: (projectId: string, chatId: string, language: string) => {
        const chat = get().getChat(projectId, chatId);
        if (!chat) return [];

        return chat.messages.map(msg => convertToDisplayMessage(msg, language));
      },

      deleteMessage: (projectId: string, chatId: string, messageId: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: state.chatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.filter(msg => msg.id !== messageId),
                    updatedAt: new Date()
                  }
                : chat
            ) || []
          }
        }));
      },

      // Function call management
      updateMessageFunctionCalls: (projectId: string, chatId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: state.chatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === messageId ? { ...msg, functionCalls } : msg
                    ),
                    updatedAt: new Date()
                  }
                : chat
            ) || []
          }
        }));
      },

      updateFunctionCallStatus: (projectId: string, chatId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string, resultMessage?: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: state.chatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === messageId ? {
                        ...msg,
                        functionCalls: msg.functionCalls?.map(funcCall =>
                          funcCall.id === functionCallId ? {
                            ...funcCall,
                            isApplied,
                            result,
                            error,
                            resultMessage: resultMessage || (isApplied ? 'Function call accepted and executed successfully' : 'Function call was rejected'),
                            appliedAt: isApplied ? new Date() : undefined
                          } : funcCall
                        )
                      } : msg
                    ),
                    updatedAt: new Date()
                  }
                : chat
            ) || []
          }
        }));
      },

      // Translation support
      addTranslatedMessage: (projectId: string, chatId: string, messageId: string, translatedContent: string, targetLanguage: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: state.chatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? {
                    ...chat,
                    messages: chat.messages.map(msg =>
                      msg.id === messageId
                        ? {
                            ...msg,
                            data: {
                              ...msg.data,
                              [targetLanguage]: { content: translatedContent }
                            }
                          }
                        : msg
                    ),
                    updatedAt: new Date()
                  }
                : chat
            ) || []
          }
        }));
      },

      getMessageForLanguage: (projectId: string, chatId: string, messageId: string, language: string) => {
        const chat = get().getChat(projectId, chatId);
        if (!chat) return null;

        const storedMessage = chat.messages.find(msg => msg.id === messageId);
        if (!storedMessage || !storedMessage.data[language]) return null;

        return convertToDisplayMessage(storedMessage, language);
      },

      hasMessageInLanguage: (projectId: string, chatId: string, messageId: string, language: string) => {
        const chat = get().getChat(projectId, chatId);
        if (!chat) return false;

        const storedMessage = chat.messages.find(msg => msg.id === messageId);
        return storedMessage ? language in storedMessage.data : false;
      },

      // Utilities
      convertToDisplayMessage,

      clearProject: (projectId: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: []
          },
          selectedChatByProject: {
            ...state.selectedChatByProject,
            [projectId]: undefined
          }
        }));
      },
    }),
    {
      name: 'chat-storage',
    }
  )
);
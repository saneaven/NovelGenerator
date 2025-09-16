import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type ChatMessage, type FunctionCallMetadata } from '../llm_request/types';

export interface Chat {
  id: string;
  name: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

interface ChatStore {
  chatsByProject: Record<string, ChatMessage[]>; // Legacy format
  multiChatsByProject: Record<string, Chat[]>; // New multi-chat format
  selectedChatByProject: Record<string, string | undefined>; // Track selected chat per project
  
  _migrateLegacyChat: (projectId: string) => string | null;

  // Legacy methods (for backwards compatibility)
  addMessage: (projectId: string, message: ChatMessage) => void;
  updateMessage: (projectId: string, messageId: string, content: string) => void;
  getChatHistory: (projectId: string) => ChatMessage[];
  clearChat: (projectId: string) => void;
  editMessage: (projectId: string, messageId: string, content: string) => void;
  deleteMessage: (projectId: string, messageId: string) => void;
  updateMessageFunctionCalls: (projectId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  updateFunctionCallStatus: (projectId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string, resultMessage?: string) => void;
  
  // New multi-chat methods
  createChat: (projectId: string, name?: string) => string;
  getChats: (projectId: string) => Chat[];
  getChat: (projectId: string, chatId: string) => Chat | undefined;
  selectChat: (projectId: string, chatId: string) => void;
  getSelectedChatId: (projectId: string) => string | undefined;
  getSelectedChat: (projectId: string) => Chat | undefined;
  renameChat: (projectId: string, chatId: string, name: string) => void;
  deleteChat: (projectId: string, chatId: string) => void;
  
  // Multi-chat message methods
  addMessageToChat: (projectId: string, chatId: string, message: ChatMessage) => void;
  updateMessageInChat: (projectId: string, chatId: string, messageId: string, content: string) => void;
  getChatMessages: (projectId: string, chatId: string) => ChatMessage[];
  editMessageInChat: (projectId: string, chatId: string, messageId: string, content: string) => void;
  deleteMessageInChat: (projectId: string, chatId: string, messageId: string) => void;
  updateMessageFunctionCallsInChat: (projectId: string, chatId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  updateFunctionCallStatusInChat: (projectId: string, chatId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string, resultMessage?: string) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      chatsByProject: {},
      multiChatsByProject: {},
      selectedChatByProject: {},

      // Helper function to migrate legacy chats to multi-chat format
      _migrateLegacyChat: (projectId: string) => {
        const state = get();
        const legacyMessages = state.chatsByProject[projectId];
        
        if (legacyMessages && legacyMessages.length > 0 && !state.multiChatsByProject[projectId]) {
          const legacyChat: Chat = {
            id: crypto.randomUUID(),
            name: 'Main Chat',
            messages: legacyMessages,
            createdAt: new Date(),
            updatedAt: new Date()
          };
          
          set((state) => ({
            multiChatsByProject: {
              ...state.multiChatsByProject,
              [projectId]: [legacyChat]
            },
            selectedChatByProject: {
              ...state.selectedChatByProject,
              [projectId]: legacyChat.id
            }
          }));
          
          return legacyChat.id;
        }
        
        return null;
      },

      // Legacy methods (updated to work with multi-chat)
      addMessage: (projectId: string, message: ChatMessage) => {
        const state = get();
        state._migrateLegacyChat(projectId);
        
        const selectedChatId = state.getSelectedChatId(projectId);
        if (selectedChatId) {
          state.addMessageToChat(projectId, selectedChatId, message);
        } else {
          // Fallback: create a new chat if none exists
          const newChatId = state.createChat(projectId);
          state.addMessageToChat(projectId, newChatId, message);
        }
      },

      updateMessage: (projectId: string, messageId: string, content: string) => {
        const state = get();
        const selectedChatId = state.getSelectedChatId(projectId);
        if (selectedChatId) {
          state.updateMessageInChat(projectId, selectedChatId, messageId, content);
        }
      },

      getChatHistory: (projectId: string) => {
        const state = get();
        state._migrateLegacyChat(projectId);
        
        const selectedChatId = state.getSelectedChatId(projectId);
        if (selectedChatId) {
          return state.getChatMessages(projectId, selectedChatId);
        }
        
        // Fallback to legacy format
        const messages = state.chatsByProject[projectId] || [];
        return messages.map(msg => ({
          ...msg,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp)
        }));
      },

      clearChat: (projectId: string) => {
        const state = get();
        const selectedChatId = state.getSelectedChatId(projectId);
        if (selectedChatId) {
          set((state) => ({
            multiChatsByProject: {
              ...state.multiChatsByProject,
              [projectId]: state.multiChatsByProject[projectId]?.map(chat =>
                chat.id === selectedChatId
                  ? { ...chat, messages: [], updatedAt: new Date() }
                  : chat
              ) || []
            }
          }));
        }
      },

      editMessage: (projectId: string, messageId: string, content: string) => {
        const state = get();
        const selectedChatId = state.getSelectedChatId(projectId);
        if (selectedChatId) {
          state.editMessageInChat(projectId, selectedChatId, messageId, content);
        }
      },

      deleteMessage: (projectId: string, messageId: string) => {
        const state = get();
        const selectedChatId = state.getSelectedChatId(projectId);
        if (selectedChatId) {
          state.deleteMessageInChat(projectId, selectedChatId, messageId);
        }
      },

      updateMessageFunctionCalls: (projectId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => {
        const state = get();
        const selectedChatId = state.getSelectedChatId(projectId);
        if (selectedChatId) {
          state.updateMessageFunctionCallsInChat(projectId, selectedChatId, messageId, functionCalls);
        }
      },

      updateFunctionCallStatus: (projectId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string, resultMessage?: string) => {
        const state = get();
        const selectedChatId = state.getSelectedChatId(projectId);
        if (selectedChatId) {
          state.updateFunctionCallStatusInChat(projectId, selectedChatId, messageId, functionCallId, isApplied, result, error, resultMessage);
        }
      },

      // New multi-chat methods
      createChat: (projectId: string, name?: string) => {
        const chatId = crypto.randomUUID();
        const now = new Date();
        const chats = get().multiChatsByProject[projectId] || [];
        const chatName = name || `Chat ${chats.length + 1}`;
        
        const newChat: Chat = {
          id: chatId,
          name: chatName,
          messages: [],
          createdAt: now,
          updatedAt: now
        };
        
        set((state) => ({
          multiChatsByProject: {
            ...state.multiChatsByProject,
            [projectId]: [...(state.multiChatsByProject[projectId] || []), newChat]
          },
          selectedChatByProject: {
            ...state.selectedChatByProject,
            [projectId]: chatId
          }
        }));
        
        return chatId;
      },

      getChats: (projectId: string) => {
        const state = get();
        return state.multiChatsByProject[projectId] || [];
      },

      getChat: (projectId: string, chatId: string) => {
        const state = get();
        const chats = state.multiChatsByProject[projectId] || [];
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
        const state = get();
        return state.selectedChatByProject[projectId];
      },

      getSelectedChat: (projectId: string) => {
        const state = get();
        const selectedChatId = state.getSelectedChatId(projectId);
        if (selectedChatId) {
          return state.getChat(projectId, selectedChatId);
        }
        return undefined;
      },

      renameChat: (projectId: string, chatId: string, name: string) => {
        set((state) => ({
          multiChatsByProject: {
            ...state.multiChatsByProject,
            [projectId]: state.multiChatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? { ...chat, name, updatedAt: new Date() }
                : chat
            ) || []
          }
        }));
      },

      deleteChat: (projectId: string, chatId: string) => {
        const state = get();
        const chats = state.multiChatsByProject[projectId] || [];
        const filteredChats = chats.filter(chat => chat.id !== chatId);
        
        set((state) => ({
          multiChatsByProject: {
            ...state.multiChatsByProject,
            [projectId]: filteredChats
          },
          selectedChatByProject: {
            ...state.selectedChatByProject,
            [projectId]: filteredChats.length > 0 ? filteredChats[0].id : undefined
          }
        }));
      },

      // Multi-chat message methods
      addMessageToChat: (projectId: string, chatId: string, message: ChatMessage) => {
        set((state) => ({
          multiChatsByProject: {
            ...state.multiChatsByProject,
            [projectId]: state.multiChatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? { ...chat, messages: [...chat.messages, message], updatedAt: new Date() }
                : chat
            ) || []
          }
        }));
      },

      updateMessageInChat: (projectId: string, chatId: string, messageId: string, content: string) => {
        set((state) => ({
          multiChatsByProject: {
            ...state.multiChatsByProject,
            [projectId]: state.multiChatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? { 
                    ...chat, 
                    messages: chat.messages.map(msg => 
                      msg.id === messageId ? { ...msg, content } : msg
                    ), 
                    updatedAt: new Date() 
                  }
                : chat
            ) || []
          }
        }));
      },

      getChatMessages: (projectId: string, chatId: string) => {
        const state = get();
        const chat = state.getChat(projectId, chatId);
        if (!chat) return [];
        
        return chat.messages.map(msg => ({
          ...msg,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp)
        }));
      },

      editMessageInChat: (projectId: string, chatId: string, messageId: string, content: string) => {
        set((state) => ({
          multiChatsByProject: {
            ...state.multiChatsByProject,
            [projectId]: state.multiChatsByProject[projectId]?.map(chat =>
              chat.id === chatId
                ? { 
                    ...chat, 
                    messages: chat.messages.map(msg => 
                      msg.id === messageId ? { ...msg, content } : msg
                    ), 
                    updatedAt: new Date() 
                  }
                : chat
            ) || []
          }
        }));
      },

      deleteMessageInChat: (projectId: string, chatId: string, messageId: string) => {
        set((state) => ({
          multiChatsByProject: {
            ...state.multiChatsByProject,
            [projectId]: state.multiChatsByProject[projectId]?.map(chat =>
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

      updateMessageFunctionCallsInChat: (projectId: string, chatId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => {
        set((state) => ({
          multiChatsByProject: {
            ...state.multiChatsByProject,
            [projectId]: state.multiChatsByProject[projectId]?.map(chat =>
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

      updateFunctionCallStatusInChat: (projectId: string, chatId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string, resultMessage?: string) => {
        set((state) => ({
          multiChatsByProject: {
            ...state.multiChatsByProject,
            [projectId]: state.multiChatsByProject[projectId]?.map(chat =>
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
    }),
    {
      name: 'chat-storage',
    }
  )
);
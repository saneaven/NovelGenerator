import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type ChatMessage, type FunctionCallMetadata } from '../llm_request/types';

interface ChatStore {
  chatsByProject: Record<string, ChatMessage[]>;
  
  addMessage: (projectId: string, message: ChatMessage) => void;
  updateMessage: (projectId: string, messageId: string, content: string) => void;
  getChatHistory: (projectId: string) => ChatMessage[];
  clearChat: (projectId: string) => void;
  editMessage: (projectId: string, messageId: string, content: string) => void;
  deleteMessage: (projectId: string, messageId: string) => void;
  updateMessageFunctionCalls: (projectId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => void;
  updateFunctionCallStatus: (projectId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string) => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      chatsByProject: {},

      addMessage: (projectId: string, message: ChatMessage) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: [...(state.chatsByProject[projectId] || []), message],
          },
        }));
      },

      updateMessage: (projectId: string, messageId: string, content: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: (state.chatsByProject[projectId] || []).map((msg) =>
              msg.id === messageId ? { ...msg, content } : msg
            ),
          },
        }));
      },

      getChatHistory: (projectId: string) => {
        const state = get();
        const messages = state.chatsByProject[projectId] || [];
        // Ensure timestamp is a Date object
        return messages.map(msg => ({
          ...msg,
          timestamp: msg.timestamp instanceof Date ? msg.timestamp : new Date(msg.timestamp)
        }));
      },


      clearChat: (projectId: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: [],
          },
        }));
      },

      editMessage: (projectId: string, messageId: string, content: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: (state.chatsByProject[projectId] || []).map((msg) =>
              msg.id === messageId ? { ...msg, content } : msg
            ),
          },
        }));
      },

      deleteMessage: (projectId: string, messageId: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: (state.chatsByProject[projectId] || []).filter((msg) => msg.id !== messageId),
          },
        }));
      },

      updateMessageFunctionCalls: (projectId: string, messageId: string, functionCalls: FunctionCallMetadata[]) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: (state.chatsByProject[projectId] || []).map((msg) =>
              msg.id === messageId ? { ...msg, functionCalls } : msg
            ),
          },
        }));
      },

      updateFunctionCallStatus: (projectId: string, messageId: string, functionCallId: string, isApplied: boolean, result?: any, error?: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: (state.chatsByProject[projectId] || []).map((msg) =>
              msg.id === messageId ? {
                ...msg,
                functionCalls: msg.functionCalls?.map(funcCall => 
                  funcCall.id === functionCallId ? { 
                    ...funcCall, 
                    isApplied, 
                    result,
                    error,
                    appliedAt: isApplied ? new Date() : undefined 
                  } : funcCall
                )
              } : msg
            ),
          },
        }));
      },
    }),
    {
      name: 'chat-storage',
    }
  )
);
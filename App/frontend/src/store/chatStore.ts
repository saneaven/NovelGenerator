import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type ChatMessage } from '../llm_request/types';

interface ChatStore {
  chatsByProject: Record<string, ChatMessage[]>;
  
  addMessage: (projectId: string, message: ChatMessage) => void;
  updateMessage: (projectId: string, messageId: string, content: string) => void;
  getChatHistory: (projectId: string) => ChatMessage[];
  clearChat: (projectId: string) => void;
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
        return state.chatsByProject[projectId] || [];
      },

      clearChat: (projectId: string) => {
        set((state) => ({
          chatsByProject: {
            ...state.chatsByProject,
            [projectId]: [],
          },
        }));
      },
    }),
    {
      name: 'chat-storage',
    }
  )
);
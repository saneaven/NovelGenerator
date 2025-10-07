/**
 * Chat service
 */

import apiClient from './client';
import type {
  ChatCreate,
  ChatUpdate,
  ChatResponse,
  ChatMessageCreate,
  ChatMessageUpdate,
  ChatMessageResponse,
} from './types';

export const chatService = {
  /**
   * Create a new chat
   */
  async createChat(projectId: string, data: ChatCreate): Promise<ChatResponse> {
    return apiClient.post<ChatResponse>(`/api/v1/projects/${projectId}/chats`, data);
  },

  /**
   * Get all chats for a project
   */
  async listChats(projectId: string): Promise<ChatResponse[]> {
    return apiClient.get<ChatResponse[]>(`/api/v1/projects/${projectId}/chats`);
  },

  /**
   * Get a specific chat with messages
   */
  async getChat(projectId: string, chatId: string): Promise<ChatResponse> {
    return apiClient.get<ChatResponse>(`/api/v1/projects/${projectId}/chats/${chatId}`);
  },

  /**
   * Update chat
   */
  async updateChat(
    projectId: string,
    chatId: string,
    data: ChatUpdate
  ): Promise<ChatResponse> {
    return apiClient.put<ChatResponse>(
      `/api/v1/projects/${projectId}/chats/${chatId}`,
      data
    );
  },

  /**
   * Delete chat
   */
  async deleteChat(projectId: string, chatId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/projects/${projectId}/chats/${chatId}`);
  },

  /**
   * Add message to chat
   */
  async addMessage(
    projectId: string,
    chatId: string,
    data: ChatMessageCreate
  ): Promise<ChatMessageResponse> {
    return apiClient.post<ChatMessageResponse>(
      `/api/v1/projects/${projectId}/chats/${chatId}/messages`,
      data
    );
  },

  /**
   * Get all messages for a chat
   */
  async listMessages(projectId: string, chatId: string): Promise<ChatMessageResponse[]> {
    return apiClient.get<ChatMessageResponse[]>(
      `/api/v1/projects/${projectId}/chats/${chatId}/messages`
    );
  },

  /**
   * Update message
   */
  async updateMessage(
    projectId: string,
    chatId: string,
    messageId: string,
    data: ChatMessageUpdate
  ): Promise<ChatMessageResponse> {
    return apiClient.put<ChatMessageResponse>(
      `/api/v1/projects/${projectId}/chats/${chatId}/messages/${messageId}`,
      data
    );
  },

  /**
   * Delete message
   */
  async deleteMessage(projectId: string, chatId: string, messageId: string): Promise<void> {
    return apiClient.delete<void>(
      `/api/v1/projects/${projectId}/chats/${chatId}/messages/${messageId}`
    );
  },
};

export default chatService;

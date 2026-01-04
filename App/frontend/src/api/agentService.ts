/**
 * Agent service
 */

import apiClient from './client';
import type {
  AgentCreate,
  AgentUpdate,
  AgentResponse,
  AgentMessageCreate,
  AgentMessageUpdate,
  AgentMessageResponse,
} from './types';

export const agentService = {
  /**
   * Create a new agent
   */
  async createAgent(projectId: string, data: AgentCreate): Promise<AgentResponse> {
    return apiClient.post<AgentResponse>(`/api/v1/projects/${projectId}/agents`, data);
  },

  /**
   * Get all agents for a project
   */
  async listAgents(projectId: string): Promise<AgentResponse[]> {
    return apiClient.get<AgentResponse[]>(`/api/v1/projects/${projectId}/agents`);
  },

  /**
   * Get a specific agent with messages
   */
  async getAgent(projectId: string, agentId: string): Promise<AgentResponse> {
    return apiClient.get<AgentResponse>(`/api/v1/projects/${projectId}/agents/${agentId}`);
  },

  /**
   * Update agent
   */
  async updateAgent(
    projectId: string,
    agentId: string,
    data: AgentUpdate
  ): Promise<AgentResponse> {
    return apiClient.put<AgentResponse>(
      `/api/v1/projects/${projectId}/agents/${agentId}`,
      data
    );
  },

  /**
   * Delete agent
   */
  async deleteAgent(projectId: string, agentId: string): Promise<void> {
    return apiClient.delete<void>(`/api/v1/projects/${projectId}/agents/${agentId}`);
  },

  /**
   * Add message to agent
   */
  async addMessage(
    projectId: string,
    agentId: string,
    data: AgentMessageCreate
  ): Promise<AgentMessageResponse> {
    return apiClient.post<AgentMessageResponse>(
      `/api/v1/projects/${projectId}/agents/${agentId}/messages`,
      data
    );
  },

  /**
   * Get all messages for an agent
   */
  async listMessages(projectId: string, agentId: string): Promise<AgentMessageResponse[]> {
    return apiClient.get<AgentMessageResponse[]>(
      `/api/v1/projects/${projectId}/agents/${agentId}/messages`
    );
  },

  /**
   * Update message
   */
  async updateMessage(
    projectId: string,
    agentId: string,
    messageId: string,
    data: AgentMessageUpdate
  ): Promise<AgentMessageResponse> {
    return apiClient.put<AgentMessageResponse>(
      `/api/v1/projects/${projectId}/agents/${agentId}/messages/${messageId}`,
      data
    );
  },

  /**
   * Delete message
   */
  async deleteMessage(projectId: string, agentId: string, messageId: string): Promise<void> {
    return apiClient.delete<void>(
      `/api/v1/projects/${projectId}/agents/${agentId}/messages/${messageId}`
    );
  },
};

export default agentService;

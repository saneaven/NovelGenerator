/**
 * Agent CRUD mutations. Each writes the `agentKeys.list(projectId)` cache.
 * Create/delete also drive the selection in the slim `agentStore` exactly as the
 * old store did (select the new agent on create; re-select the first remaining
 * on delete).
 */

import { useMutation } from '@tanstack/react-query';
import { agentService } from '../../../api';
import { queryClient } from '../../queryClient';
import { agentKeys } from '../../keys/agentKeys';
import { useAgentStore } from '../../../store/agentStore';
import {
  convertBackendAgent,
  readAgentsFromCache,
  sortAgentsByLastActivity,
  type Agent,
} from '../useAgentsQuery';

function requireProjectId(projectId: string | null | undefined): string {
  if (!projectId) throw new Error('Agent mutation requires a projectId');
  return projectId;
}

/** Create an agent (default name "Agent N"), append to cache, and select it. */
export function useCreateAgentMutation(projectId: string | null | undefined) {
  return useMutation({
    mutationFn: async (name?: string): Promise<Agent> => {
      const pid = requireProjectId(projectId);
      const agentName = name || `Agent ${readAgentsFromCache(pid).length + 1}`;
      const created = await agentService.createAgent(pid, { name: agentName });
      return convertBackendAgent(created);
    },
    onSuccess: (agent) => {
      const pid = agent.project_id;
      queryClient.setQueryData<Agent[]>(agentKeys.list(pid), (prev) =>
        sortAgentsByLastActivity([...(prev ?? []), agent]),
      );
      useAgentStore.getState().selectAgent(pid, agent.id);
    },
  });
}

export interface RenameAgentVars {
  agentId: string;
  name: string;
}

export function useRenameAgentMutation(projectId: string | null | undefined) {
  return useMutation({
    mutationFn: async ({ agentId, name }: RenameAgentVars): Promise<Agent> => {
      const pid = requireProjectId(projectId);
      const updated = await agentService.updateAgent(pid, agentId, { name });
      return convertBackendAgent(updated);
    },
    onSuccess: (agent) => {
      queryClient.setQueryData<Agent[]>(agentKeys.list(agent.project_id), (prev) =>
        prev?.map((a) => (a.id === agent.id ? agent : a)),
      );
    },
  });
}

export function useDeleteAgentMutation(projectId: string | null | undefined) {
  return useMutation({
    mutationFn: async (agentId: string): Promise<string> => {
      const pid = requireProjectId(projectId);
      await agentService.deleteAgent(pid, agentId);
      return agentId;
    },
    onSuccess: (agentId) => {
      const pid = requireProjectId(projectId);
      const remaining = readAgentsFromCache(pid).filter((a) => a.id !== agentId);
      queryClient.setQueryData<Agent[]>(agentKeys.list(pid), remaining);
      const store = useAgentStore.getState();
      if (store.getSelectedAgentId(pid) === agentId && remaining.length > 0) {
        store.selectAgent(pid, remaining[0].id);
      }
    },
  });
}

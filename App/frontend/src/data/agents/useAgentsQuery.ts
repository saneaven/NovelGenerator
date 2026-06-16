/**
 * Agent list (per project) as a TanStack Query. Replaces the `agentStore`
 * server half (`agentsByProject` + `fetchAgents`). The selected-agent SELECTION
 * stays in the slim `agentStore`; the fetch-time auto-select/auto-create
 * reconciliation moved to `useEnsureAgentSelection`.
 */

import { useQuery } from '@tanstack/react-query';
import { agentService, type AgentResponse } from '../../api';
import { queryClient } from '../queryClient';
import { agentKeys } from '../keys/agentKeys';
import { useSelectionStore } from '../../store/selectionStore';

export interface Agent {
  id: string;
  name: string;
  project_id: string;
  thread_id?: string | null;
  archived_until_message_id?: string | null;
  created_at: string;
  updated_at: string;
}

export function getAgentLastActivityAt(agent: Agent): Date {
  const updatedAt = new Date(agent.updated_at);
  if (!Number.isNaN(updatedAt.getTime())) return updatedAt;

  const createdAt = new Date(agent.created_at);
  if (!Number.isNaN(createdAt.getTime())) return createdAt;

  return new Date(0);
}

export function sortAgentsByLastActivity(agents: Agent[]): Agent[] {
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

export function convertBackendAgent(agent: AgentResponse): Agent {
  return {
    id: agent.id,
    name: agent.name,
    project_id: agent.project_id,
    thread_id: (agent as { thread_id?: string | null }).thread_id ?? null,
    archived_until_message_id: (agent as { archived_until_message_id?: string | null }).archived_until_message_id ?? null,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
  };
}

const EMPTY: Agent[] = [];

export function agentsQueryOptions(projectId: string) {
  return {
    queryKey: agentKeys.list(projectId),
    queryFn: async (): Promise<Agent[]> => {
      const backendAgents = await agentService.listAgents(projectId);
      const agents = Array.isArray(backendAgents) ? backendAgents.map(convertBackendAgent) : [];
      return sortAgentsByLastActivity(agents);
    },
  } as const;
}

export function useAgentsQuery(projectId: string | null | undefined) {
  return useQuery({
    ...agentsQueryOptions(projectId ?? '__none__'),
    enabled: Boolean(projectId),
  });
}

/** The agent list for a project (empty array until loaded). */
export function useAgents(projectId: string | null | undefined): Agent[] {
  return useAgentsQuery(projectId).data ?? EMPTY;
}

/** A single agent by id, reactively. */
export function useAgent(projectId: string | null | undefined, agentId: string | null | undefined): Agent | undefined {
  const agents = useAgents(projectId);
  return agentId ? agents.find((a) => a.id === agentId) : undefined;
}

/** Reactive selected-agent id for a project (selection lives in the slim store). */
export function useSelectedAgentId(projectId: string): string | undefined {
  return useSelectionStore((s) => s.selectedAgentByProject[projectId]);
}

/** The selected agent (selection from the store + list from the query). */
export function useSelectedAgent(projectId: string): Agent | undefined {
  const selectedId = useSelectedAgentId(projectId);
  const agents = useAgents(projectId);
  return selectedId ? agents.find((a) => a.id === selectedId) : undefined;
}

/** Non-React read of a project's agent list from cache. */
export function readAgentsFromCache(projectId: string): Agent[] {
  return queryClient.getQueryData<Agent[]>(agentKeys.list(projectId)) ?? [];
}

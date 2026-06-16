/**
 * Reconciles agent selection after the list loads — the side-effect half of the
 * old `fetchAgents`: restore a valid localStorage selection, else select the
 * first agent; if the project has no agents, auto-create "Main Agent".
 *
 * Call this once where a project's agents should be ensured (the workspace).
 */

import { useEffect, useRef } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useAgentsQuery } from './useAgentsQuery';
import { useCreateAgentMutation } from './mutations/useAgentMutations';

export function useEnsureAgentSelection(projectId: string | null | undefined): void {
  const agentsQuery = useAgentsQuery(projectId);
  const createAgentMutation = useCreateAgentMutation(projectId);
  const creatingRef = useRef(false);

  const { isSuccess, data } = agentsQuery;

  useEffect(() => {
    if (!projectId || !isSuccess) return;
    const agents = data ?? [];
    const store = useAgentStore.getState();

    if (agents.length === 0) {
      // Auto-create the first agent (guard against duplicate in-flight creates).
      if (!creatingRef.current && !createAgentMutation.isPending) {
        creatingRef.current = true;
        void createAgentMutation
          .mutateAsync('Main Agent')
          .finally(() => {
            creatingRef.current = false;
          });
      }
      return;
    }

    const currentSelection = store.getSelectedAgentId(projectId);
    const storedSelection = currentSelection ?? localStorage.getItem(`selectedAgent_${projectId}`) ?? undefined;
    const validSelection = storedSelection && agents.some((a) => a.id === storedSelection)
      ? storedSelection
      : undefined;

    if (validSelection) {
      if (currentSelection !== validSelection) {
        store.selectAgent(projectId, validSelection);
      }
    } else {
      store.selectAgent(projectId, agents[0].id);
    }
  }, [projectId, isSuccess, data, createAgentMutation]);
}

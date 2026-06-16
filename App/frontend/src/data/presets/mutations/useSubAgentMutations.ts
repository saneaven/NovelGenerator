/**
 * Sub-agent CRUD, scoped to the active preset.
 *
 * Each mutation writes the `presetKeys.subAgents(presetId)` cache directly,
 * reproducing the old subAgentStore's array splices.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { subAgentService } from '../../../api/subAgentService';
import { presetKeys } from '../../keys/presetKeys';
import type {
  SubAgentCreatePayload,
  SubAgentDefinition,
  SubAgentUpdate,
} from '../../../types/subAgents';

export function useCreateSubAgentMutation(presetId: string | null | undefined) {
  const qc = useQueryClient();
  const key = presetKeys.subAgents(presetId ?? '__none__');
  return useMutation({
    mutationFn: (data: SubAgentCreatePayload) => subAgentService.create(data),
    onSuccess: (created) => {
      qc.setQueryData<SubAgentDefinition[]>(key, (prev) => (prev ? [...prev, created] : [created]));
    },
  });
}

export interface UpdateSubAgentVars {
  id: string;
  data: SubAgentUpdate;
}

export function useUpdateSubAgentMutation(presetId: string | null | undefined) {
  const qc = useQueryClient();
  const key = presetKeys.subAgents(presetId ?? '__none__');
  return useMutation({
    mutationFn: ({ id, data }: UpdateSubAgentVars) => subAgentService.update(id, data),
    onSuccess: (updated) => {
      qc.setQueryData<SubAgentDefinition[]>(key, (prev) =>
        prev?.map((s) => (s.id === updated.id ? updated : s)),
      );
    },
  });
}

export function useDeleteSubAgentMutation(presetId: string | null | undefined) {
  const qc = useQueryClient();
  const key = presetKeys.subAgents(presetId ?? '__none__');
  return useMutation({
    mutationFn: (id: string) => subAgentService.delete(id),
    onSuccess: (_res, id) => {
      qc.setQueryData<SubAgentDefinition[]>(key, (prev) => prev?.filter((s) => s.id !== id));
    },
  });
}

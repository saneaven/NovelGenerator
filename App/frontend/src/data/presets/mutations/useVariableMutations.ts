/**
 * Prompt-variable CRUD, scoped to the active preset.
 *
 * Every mutation writes the `presetKeys.variables(presetId)` cache directly.
 * `useUpdateVariableValueMutation` and `useReorderVariablesMutation` reproduce
 * the old store's optimistic-update + manual-rollback via onMutate/onError/
 * onSettled (see data/objects/mutations/useUpdateObjectMutation for the pattern).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { variableService } from '../../../api/variableService';
import { presetKeys } from '../../keys/presetKeys';
import type {
  PromptVariable,
  VariableCreate,
  VariableDefinitionUpdate,
} from '../../../types/variables';

type VariableValue = string | number | boolean | null;

export function useCreateVariableMutation(presetId: string | null | undefined) {
  const qc = useQueryClient();
  const key = presetKeys.variables(presetId ?? '__none__');
  return useMutation({
    mutationFn: (data: VariableCreate) => variableService.createVariable(data),
    onSuccess: (created) => {
      qc.setQueryData<PromptVariable[]>(key, (prev) => (prev ? [...prev, created] : [created]));
    },
  });
}

export interface UpdateVariableValueVars {
  id: string;
  value: VariableValue;
}

/** Optimistic value edit (auto-save) with rollback, then replace with server row. */
export function useUpdateVariableValueMutation(presetId: string | null | undefined) {
  const qc = useQueryClient();
  const key = presetKeys.variables(presetId ?? '__none__');
  return useMutation({
    mutationFn: ({ id, value }: UpdateVariableValueVars) =>
      variableService.updateVariableValueById(id, value),
    onMutate: async ({ id, value }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PromptVariable[]>(key);
      if (prev) {
        qc.setQueryData<PromptVariable[]>(
          key,
          prev.map((v) => (v.id === id ? { ...v, value } : v)),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: (updated) => {
      qc.setQueryData<PromptVariable[]>(key, (prev) =>
        prev?.map((v) => (v.id === updated.id ? updated : v)),
      );
    },
  });
}

export interface UpdateVariableDefinitionVars {
  id: string;
  data: VariableDefinitionUpdate;
}

export function useUpdateVariableDefinitionMutation(presetId: string | null | undefined) {
  const qc = useQueryClient();
  const key = presetKeys.variables(presetId ?? '__none__');
  return useMutation({
    mutationFn: ({ id, data }: UpdateVariableDefinitionVars) =>
      variableService.updateVariableDefinitionById(id, data),
    onSuccess: (updated) => {
      qc.setQueryData<PromptVariable[]>(key, (prev) =>
        prev?.map((v) => (v.id === updated.id ? updated : v)),
      );
    },
  });
}

export function useDeleteVariableMutation(presetId: string | null | undefined) {
  const qc = useQueryClient();
  const key = presetKeys.variables(presetId ?? '__none__');
  return useMutation({
    mutationFn: (id: string) => variableService.deleteVariableById(id),
    onSuccess: (_res, id) => {
      qc.setQueryData<PromptVariable[]>(key, (prev) => prev?.filter((v) => v.id !== id));
    },
  });
}

/** Optimistic reorder with rollback (mirrors the old store's manual revert). */
export function useReorderVariablesMutation(presetId: string | null | undefined) {
  const qc = useQueryClient();
  const key = presetKeys.variables(presetId ?? '__none__');
  return useMutation({
    mutationFn: (orderedIds: string[]) => variableService.reorderVariables(orderedIds),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<PromptVariable[]>(key);
      if (prev) {
        const reordered = orderedIds
          .map((id, index) => {
            const variable = prev.find((v) => v.id === id);
            return variable ? { ...variable, display_order: index } : null;
          })
          .filter((v): v is PromptVariable => v !== null);
        qc.setQueryData<PromptVariable[]>(key, reordered);
      }
      return { prev };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
  });
}

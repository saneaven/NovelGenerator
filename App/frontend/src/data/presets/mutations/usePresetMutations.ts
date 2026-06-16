/**
 * Preset CRUD + the active-preset switch.
 *
 * `useSetActivePresetMutation` replaces the old `presetStore.setActivePreset`
 * cross-store reset cascade: instead of calling `.getState().reset()` on the
 * variable / sub-agent / mcp / settings stores, it
 *   1. flips `is_active` in the cached presets list (so `useActivePresetId`
 *      re-points the preset-scoped queries at the new id's keys), and
 *   2. invalidates the scenario subtree + the new preset's scoped keys.
 *
 * The preset-scoped queries (variables/subAgents/mcp) are keyed by presetId, so
 * step (1) alone already swaps every consumer onto fresh data; the invalidation
 * in step (2) is belt-and-suspenders for a preset visited before.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { presetService } from '../../../api/presetService';
import { presetKeys } from '../../keys/presetKeys';
import { settingsKeys } from '../../keys/settingsKeys';
import type {
  PresetCreate,
  PresetDuplicateRequest,
  PresetImportRequest,
  PresetListItem,
  PresetResponse,
  PresetUpdate,
} from '../../../types/presets';

function toListItem(preset: PresetResponse): PresetListItem {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    is_active: false,
    created_at: preset.created_at,
    updated_at: preset.updated_at,
  };
}

/** Append a not-yet-active preset to the cached list (create/duplicate/import). */
function appendToListCache(qc: ReturnType<typeof useQueryClient>, preset: PresetResponse) {
  qc.setQueryData<PresetListItem[]>(presetKeys.list(), (prev) =>
    prev ? [...prev, toListItem(preset)] : [toListItem(preset)],
  );
}

export function useCreatePresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PresetCreate) => presetService.createPreset(data),
    onSuccess: (created) => appendToListCache(qc, created),
  });
}

export interface DuplicatePresetVars {
  presetId: string;
  data: PresetDuplicateRequest;
}

export function useDuplicatePresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ presetId, data }: DuplicatePresetVars) => presetService.duplicatePreset(presetId, data),
    onSuccess: (created) => appendToListCache(qc, created),
  });
}

export function useImportPresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: PresetImportRequest) => presetService.importPreset(data),
    onSuccess: (created) => appendToListCache(qc, created),
  });
}

export interface UpdatePresetVars {
  presetId: string;
  data: PresetUpdate;
}

export function useUpdatePresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ presetId, data }: UpdatePresetVars) => presetService.updatePreset(presetId, data),
    onSuccess: (updated, { presetId }) => {
      qc.setQueryData<PresetListItem[]>(presetKeys.list(), (prev) =>
        prev?.map((p) =>
          p.id === presetId
            ? { ...p, name: updated.name, description: updated.description, updated_at: updated.updated_at }
            : p,
        ),
      );
    },
  });
}

export function useDeletePresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (presetId: string) => presetService.deletePreset(presetId),
    onSuccess: (_res, presetId) => {
      qc.setQueryData<PresetListItem[]>(presetKeys.list(), (prev) =>
        prev?.filter((p) => p.id !== presetId),
      );
    },
  });
}

/**
 * Switch the active preset. The spaghetti-fix: query invalidations instead of
 * cross-store `getState()` resets.
 */
export function useSetActivePresetMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (presetId: string) => presetService.setActivePreset(presetId),
    onSuccess: (_res, presetId) => {
      // 1. Flip is_active in the presets list cache → useActivePresetId re-points
      //    the preset-scoped (variables/subAgents/mcp) queries at this id's keys.
      qc.setQueryData<PresetListItem[]>(presetKeys.list(), (prev) =>
        prev?.map((p) => ({ ...p, is_active: p.id === presetId })),
      );

      // 2. Scenario cache is owned by settingsStore (migrated separately); just
      //    drop its subtree so it refetches under the new preset.
      qc.invalidateQueries({ queryKey: settingsKeys.scenarios(), exact: false });

      // 3. Belt-and-suspenders: refresh the new preset's scoped data (covers a
      //    preset previously visited whose cached data is now stale).
      qc.invalidateQueries({ queryKey: presetKeys.variables(presetId) });
      qc.invalidateQueries({ queryKey: presetKeys.subAgents(presetId) });
      qc.invalidateQueries({ queryKey: presetKeys.mcpServers(presetId) });
    },
  });
}

/** Export a preset as JSON (no cache writes). */
export function useExportPresetMutation() {
  return useMutation({
    mutationFn: (presetId: string) => presetService.exportPreset(presetId),
  });
}

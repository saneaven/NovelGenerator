/**
 * Asset write mutations (upload, update/rename, delete, set-main).
 *
 * Replaces the old assetStore's hand-rolled multi-keyed cache surgery with
 * query invalidation:
 *   - upload  → bound scope (project list + object links or scene) refetches
 *   - delete  → every project-scoped asset query refetches (old code stripped
 *               the id from the project list + all object-link + all scene keys)
 *   - rename  → every project-scoped asset query refetches (old code patched the
 *               asset across all of them)
 *   - setMain → just that object's links refetch (old code flipped is_main there)
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { assetService } from '../../api/assetService';
import { assetKeys } from '../keys/assetKeys';
import type { Asset } from '../../api/assetService';

interface AssetBinding {
  manuscriptId?: string;
  objectType?: string;
  objectId?: string;
}

/** Match every asset query for a project across all scopes. */
function invalidateProjectScope(
  qc: ReturnType<typeof useQueryClient>,
  projectId: string,
): Promise<void> {
  return qc.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      return Array.isArray(key) && key[0] === assetKeys.all[0] && key.includes(projectId);
    },
  });
}

export interface UploadAssetVars {
  projectId: string;
  file: File;
  name?: string;
  assetType?: 'scene' | 'object';
  binding?: AssetBinding;
}

export function useUploadAssetMutation() {
  const qc = useQueryClient();
  return useMutation<Asset, Error, UploadAssetVars>({
    mutationFn: ({ projectId, file, name, assetType, binding }) =>
      assetService.uploadAsset(projectId, file, name, assetType, binding),
    onSuccess: (_asset, { projectId, binding }) => {
      qc.invalidateQueries({ queryKey: assetKeys.projectAssets(projectId) });
      if (binding?.objectType && binding?.objectId) {
        qc.invalidateQueries({
          queryKey: assetKeys.objectAssetLinks(projectId, binding.objectType, binding.objectId),
        });
      }
      if (binding?.manuscriptId !== undefined || binding?.objectType === undefined) {
        // Scene uploads land in the manuscript-scoped list and the "all scenes" list.
        qc.invalidateQueries({ queryKey: assetKeys.sceneAssets(projectId, binding?.manuscriptId) });
        qc.invalidateQueries({ queryKey: assetKeys.sceneAssets(projectId) });
      }
    },
  });
}

export interface UpdateAssetVars {
  projectId: string;
  assetId: string;
  name: string;
}

export function useUpdateAssetMutation() {
  const qc = useQueryClient();
  return useMutation<Asset, Error, UpdateAssetVars>({
    mutationFn: ({ projectId, assetId, name }) => assetService.updateAsset(projectId, assetId, name),
    // A rename can surface anywhere the asset is referenced; refresh every scope.
    onSuccess: (_asset, { projectId }) => invalidateProjectScope(qc, projectId),
  });
}

export interface DeleteAssetVars {
  projectId: string;
  assetId: string;
}

export function useDeleteAssetMutation() {
  const qc = useQueryClient();
  return useMutation<void, Error, DeleteAssetVars>({
    mutationFn: ({ projectId, assetId }) => assetService.deleteAsset(projectId, assetId),
    // The deleted asset may appear in the project list, any object links, and any
    // scene list — invalidate the whole project scope (old store stripped it from all).
    onSuccess: (_res, { projectId }) => invalidateProjectScope(qc, projectId),
  });
}

export interface SetMainAssetVars {
  projectId: string;
  objectType: string;
  objectId: string;
  assetId: string;
}

export function useSetMainAssetMutation() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, SetMainAssetVars>({
    mutationFn: ({ projectId, objectType, objectId, assetId }) =>
      assetService.setMainAsset(projectId, objectType, objectId, assetId),
    onSuccess: (_res, { projectId, objectType, objectId }) => {
      qc.invalidateQueries({
        queryKey: assetKeys.objectAssetLinks(projectId, objectType, objectId),
      });
    },
  });
}

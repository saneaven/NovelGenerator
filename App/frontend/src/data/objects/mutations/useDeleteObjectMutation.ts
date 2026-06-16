/**
 * Delete an object. The backend cascades folder subtrees, so we drop the
 * object's detail queries and invalidate the owning collection / story tree
 * (all languages) — replacing the old store's manual subtree cache surgery.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unifiedObjectService } from '../../../api/unifiedObjectService';
import { objectKeys } from '../../keys/objectKeys';
import { isStoryEntityTreeType } from '../../../domain/objectFormat';
import type { ObjectType } from '../../../types/unifiedObject';

export interface DeleteObjectVars {
  type: ObjectType;
  id: string;
  /** Required for collection/tree invalidation after delete. */
  projectId: string;
}

export function useDeleteObjectMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id }: DeleteObjectVars) => unifiedObjectService.deleteObject(type, id),
    onSuccess: (_res, { type, id, projectId }) => {
      qc.removeQueries({ queryKey: objectKeys.detailOf(type, id) });
      if (isStoryEntityTreeType(type)) {
        qc.invalidateQueries({ queryKey: objectKeys.storyTreesOf(projectId) });
      } else {
        qc.invalidateQueries({ queryKey: objectKeys.collectionType(projectId, type) });
      }
    },
  });
}

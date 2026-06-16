/** Patch a story-entity/folder's structure (move/reorder). Invalidates the tree. */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unifiedObjectService } from '../../../api/unifiedObjectService';
import { objectKeys } from '../../keys/objectKeys';
import type { StoryEntityStructureObjectType } from '../../../types/unifiedObject';

export interface PatchObjectStructureVars {
  type: StoryEntityStructureObjectType;
  id: string;
  metadata: Record<string, unknown>;
}

export function usePatchObjectStructureMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, metadata }: PatchObjectStructureVars) =>
      unifiedObjectService.patchObjectStructure(type, id, { metadata }),
    onSuccess: (updated) => {
      const language = updated.language_state?.requested_language;
      if (language) {
        qc.setQueryData(objectKeys.detail(updated.type, updated.id, language), updated);
      }
      const projectId = updated.metadata?.project_id;
      if (typeof projectId === 'string') {
        qc.invalidateQueries({ queryKey: objectKeys.storyTreesOf(projectId) });
      }
    },
  });
}

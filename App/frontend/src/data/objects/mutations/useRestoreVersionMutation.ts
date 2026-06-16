/** Restore a previous version (creates a new latest version). Refetches object + versions. */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unifiedObjectService } from '../../../api/unifiedObjectService';
import { objectKeys } from '../../keys/objectKeys';
import { defaultRichTextFormatForType } from '../../../domain/objectFormat';
import type { ObjectType } from '../../../types/unifiedObject';

export interface RestoreVersionVars {
  type: ObjectType;
  id: string;
  versionId: string;
}

export function useRestoreVersionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, versionId }: RestoreVersionVars) =>
      unifiedObjectService.restoreVersion(type, id, versionId, defaultRichTextFormatForType(type)),
    onSuccess: (_res, { type, id }) => {
      qc.invalidateQueries({ queryKey: objectKeys.detailOf(type, id) });
      qc.invalidateQueries({ queryKey: objectKeys.versions(type, id) });
    },
  });
}

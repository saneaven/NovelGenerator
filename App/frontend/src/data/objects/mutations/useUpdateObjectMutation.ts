/**
 * Update an object (optimistic). Reproduces the special cases from the old
 * unifiedObjectStore.updateObject without any hydration bookkeeping:
 * - optimistic merge into the detail (tiptap) cache, rolled back on error
 * - markdown sibling refreshed on settle (rich types)
 * - outline structure edits (position/parent_id) invalidate the outline collection
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unifiedObjectService } from '../../../api/unifiedObjectService';
import { objectKeys } from '../../keys/objectKeys';
import { defaultRichTextFormatForType, isRichPreviewType, isStoryEntityTreeType } from '../../../domain/objectFormat';
import type { ObjectType, UnifiedObject, UpdateObjectRequest } from '../../../types/unifiedObject';

function isOutlineStructureMetadata(metadata?: Record<string, unknown>): boolean {
  if (!metadata) return false;
  return 'position' in metadata || 'parent_id' in metadata;
}

export interface UpdateObjectVars {
  type: ObjectType;
  id: string;
  request: UpdateObjectRequest;
}

export function useUpdateObjectMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, request }: UpdateObjectVars) =>
      unifiedObjectService.updateObject(type, id, {
        ...request,
        rich_text_format: request.rich_text_format ?? defaultRichTextFormatForType(type),
      }),
    onMutate: async ({ type, id, request }) => {
      const key = objectKeys.detail(type, id, request.language);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<UnifiedObject>(key);
      if (prev) {
        qc.setQueryData<UnifiedObject>(key, { ...prev, data: { ...prev.data, ...request.data } });
      }
      return { prev, key };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSuccess: (updated, { type, request }) => {
      qc.setQueryData(objectKeys.detail(type, updated.id, request.language), updated);
      const projectId = updated.metadata?.project_id;

      // New version holds only the edited language → other languages are now stale.
      if (request.create_new_version !== false) {
        qc.removeQueries({
          queryKey: objectKeys.detailOf(type, updated.id),
          predicate: (q) => q.queryKey[4] !== request.language,
        });
        if (typeof projectId === 'string') {
          if (isStoryEntityTreeType(type)) {
            qc.invalidateQueries({
              queryKey: objectKeys.storyTreesOf(projectId),
              predicate: (q) => q.queryKey[3] !== request.language,
            });
          } else {
            qc.invalidateQueries({
              queryKey: objectKeys.collectionType(projectId, type),
              predicate: (q) => q.queryKey[4] !== request.language,
            });
          }
        }
      }

      if (
        type === 'outline'
        && typeof projectId === 'string'
        && isOutlineStructureMetadata(request.metadata as Record<string, unknown> | undefined)
      ) {
        qc.invalidateQueries({ queryKey: objectKeys.collectionLang(projectId, 'outline', request.language) });
      }
    },
    onSettled: (_updated, _err, { type, id, request }) => {
      if (isRichPreviewType(type)) {
        qc.invalidateQueries({ queryKey: objectKeys.detail(type, id, request.language, 'markdown') });
      }
    },
  });
}

/**
 * Update an object (optimistic). Reproduces the special cases from the old
 * unifiedObjectStore.updateObject without any hydration bookkeeping:
 * - optimistic merge into the detail (tiptap) cache, rolled back on error
 * - response projection written into detail/list caches without broad refetches
 * - SSE follows up with markdown/collection patches for rich preview siblings
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unifiedObjectService } from '../../../api/unifiedObjectService';
import { objectKeys } from '../../keys/objectKeys';
import { writeObjectToCacheFromSSE } from '../../sse/sseObjectBridge';
import { defaultRichTextFormatForType } from '../../../domain/objectFormat';
import type { ObjectType, UnifiedObject, UpdateObjectRequest } from '../../../types/unifiedObject';

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
      const format = request.rich_text_format ?? defaultRichTextFormatForType(type);
      const key = objectKeys.detail(type, id, request.language, format);
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
      const format = request.rich_text_format ?? defaultRichTextFormatForType(type);
      void writeObjectToCacheFromSSE(updated, null, request.language, 'updated', format);
    },
  });
}

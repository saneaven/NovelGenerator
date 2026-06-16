/**
 * Add / delete a translation for one object. Both invalidate every cached
 * language+format of that object so its language availability refreshes
 * (replacing the old store's single-object refetch).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unifiedObjectService } from '../../../api/unifiedObjectService';
import { objectKeys } from '../../keys/objectKeys';
import { defaultRichTextFormatForType } from '../../../domain/objectFormat';
import type { ObjectType, AddTranslationRequest } from '../../../types/unifiedObject';

export interface AddTranslationVars {
  type: ObjectType;
  id: string;
  request: AddTranslationRequest;
}

export function useAddTranslationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, request }: AddTranslationVars) =>
      unifiedObjectService.addTranslation(type, id, {
        ...request,
        rich_text_format: request.rich_text_format ?? defaultRichTextFormatForType(type),
      }),
    onSuccess: (_res, { type, id }) => {
      qc.invalidateQueries({ queryKey: objectKeys.detailOf(type, id) });
    },
  });
}

export interface DeleteTranslationVars {
  type: ObjectType;
  id: string;
  language: string;
}

export function useDeleteTranslationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, language }: DeleteTranslationVars) =>
      unifiedObjectService.deleteTranslation(type, id, language),
    onSuccess: (_res, { type, id }) => {
      qc.invalidateQueries({ queryKey: objectKeys.detailOf(type, id) });
    },
  });
}

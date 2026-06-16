/**
 * Update image prompts (metadata, language-agnostic). Merges the result into
 * every cached language+format detail of the object via setQueriesData.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unifiedObjectService } from '../../../api/unifiedObjectService';
import { objectKeys } from '../../keys/objectKeys';
import type { ObjectType, UnifiedObject } from '../../../types/unifiedObject';

export interface UpdateImagePromptVars {
  type: ObjectType;
  id: string;
  prompts: {
    image_prompt?: string;
    image_prompt_positive?: string;
    image_prompt_negative?: string;
  };
}

export function useUpdateImagePromptMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id, prompts }: UpdateImagePromptVars) =>
      unifiedObjectService.updateImagePrompt(type, id, prompts),
    onSuccess: (result, { type, id }) => {
      qc.setQueriesData<UnifiedObject>(
        { queryKey: objectKeys.detailOf(type, id) },
        (old) =>
          old
            ? {
                ...old,
                metadata: {
                  ...old.metadata,
                  image_prompt: result.image_prompt,
                  image_prompt_positive: result.image_prompt_positive,
                  image_prompt_negative: result.image_prompt_negative,
                },
              }
            : old,
      );
    },
  });
}

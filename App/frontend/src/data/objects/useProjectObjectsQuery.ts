/**
 * Composite query producing the SimplifiedProjectObjects chat-context structure.
 * Replaces the old useProjectObjects hook (which read the god store's objects map).
 *
 * Fetches the collections the structure needs (basic_info, story_entity, outline)
 * in the target language and feeds them to the single-source domain builder.
 */

import { useQueries } from '@tanstack/react-query';
import { objectKeys } from '../keys/objectKeys';
import { defaultRichTextFormatForType } from '../../domain/objectFormat';
import { buildSimplifiedProjectObjects, type SimplifiedProjectObjects } from '../../domain/projectObjects';
import { fetchObjectCollection } from './useObjectCollectionQuery';
import type { ObjectType } from '../../types/unifiedObject';

const PROJECT_TYPES: ObjectType[] = ['basic_info', 'story_entity', 'outline'];

export interface ProjectObjectsResult {
  data: SimplifiedProjectObjects;
  isLoading: boolean;
  isError: boolean;
}

export function useProjectObjectsQuery(
  projectId: string | undefined,
  language: string,
): ProjectObjectsResult {
  return useQueries({
    queries: PROJECT_TYPES.map((type) => {
      const fmt = defaultRichTextFormatForType(type);
      return {
        queryKey: objectKeys.collection(projectId ?? '__none__', type, language, fmt),
        queryFn: () => fetchObjectCollection(projectId as string, type, language, fmt),
        enabled: Boolean(projectId),
      };
    }),
    combine: (results) => ({
      data: buildSimplifiedProjectObjects(results.flatMap((r) => r.data ?? [])),
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
    }),
  });
}

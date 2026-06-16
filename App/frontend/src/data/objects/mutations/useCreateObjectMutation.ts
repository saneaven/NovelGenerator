/**
 * Create an object. Reproduces unifiedObjectStore.createObject side effects:
 * - seed the new object's detail cache
 * - invalidate the owning collection (or story tree)
 * - outline+chapter creation refreshes the linked manuscript
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unifiedObjectService } from '../../../api/unifiedObjectService';
import { objectKeys } from '../../keys/objectKeys';
import { defaultRichTextFormatForType, isStoryEntityTreeType } from '../../../domain/objectFormat';
import type { ObjectType, StoryEntityKind, OutlineKind } from '../../../types/unifiedObject';

export interface CreateObjectVars {
  type: ObjectType;
  projectId: string;
  data: unknown;
  language: string;
  metadata?: Record<string, unknown>;
  userRequest?: string;
  kind?: StoryEntityKind | OutlineKind;
}

export function useCreateObjectMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, projectId, data, language, metadata, userRequest, kind }: CreateObjectVars) =>
      unifiedObjectService.createObject(type, projectId, {
        data,
        language,
        rich_text_format: defaultRichTextFormatForType(type),
        kind,
        user_request: userRequest ?? 'User Creation',
        metadata,
      }),
    onSuccess: (newObject, { type, projectId, language, kind }) => {
      qc.setQueryData(objectKeys.detail(type, newObject.id, language), newObject);
      if (isStoryEntityTreeType(type)) {
        qc.invalidateQueries({ queryKey: objectKeys.storyTreeLang(projectId, language) });
      } else {
        qc.invalidateQueries({ queryKey: objectKeys.collectionLang(projectId, type, language) });
      }
      if (type === 'outline' && kind === 'chapter') {
        const manuscriptId = newObject.metadata?.manuscript_id;
        if (typeof manuscriptId === 'string' && manuscriptId.length > 0) {
          qc.invalidateQueries({ queryKey: objectKeys.detailLang('manuscript', manuscriptId, language) });
        }
      }
    },
  });
}

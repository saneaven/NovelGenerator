/** Query for a project's story-entity tree (folders + entities). */

import { useQuery } from '@tanstack/react-query';
import { unifiedObjectService } from '../../api/unifiedObjectService';
import { objectKeys, type ObjectRichTextFormat } from '../keys/objectKeys';

export function useStoryEntityTreeQuery(
  projectId: string | undefined,
  language: string,
  format: ObjectRichTextFormat = 'tiptap',
) {
  return useQuery({
    queryKey: objectKeys.storyTree(projectId ?? '__none__', language, format),
    queryFn: () =>
      unifiedObjectService.getStoryEntityTree(projectId as string, {
        language,
        rich_text_format: format,
      }),
    enabled: Boolean(projectId),
  });
}

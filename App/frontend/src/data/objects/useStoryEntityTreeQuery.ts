/** Query for a project's story-entity tree (folders + entities). */

import { useQuery } from '@tanstack/react-query';
import { unifiedObjectService } from '../../api/unifiedObjectService';
import { objectKeys, type ObjectRichTextFormat } from '../keys/objectKeys';

/**
 * @param summary When true, fetch the lightweight tree (no rich-text `content`)
 *   — for navigation/structure views. Cached under a separate key variant.
 */
export function useStoryEntityTreeQuery(
  projectId: string | undefined,
  language: string,
  format: ObjectRichTextFormat = 'tiptap',
  summary = false,
) {
  return useQuery({
    queryKey: objectKeys.storyTree(projectId ?? '__none__', language, format, summary ? 'summary' : 'full'),
    queryFn: () =>
      unifiedObjectService.getStoryEntityTree(projectId as string, {
        language,
        rich_text_format: format,
        include_content: summary ? false : undefined,
      }),
    enabled: Boolean(projectId),
  });
}

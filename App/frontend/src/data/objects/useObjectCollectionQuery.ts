/**
 * Query for a collection of one object type within a project.
 *
 * Pagination (the old fetchAllOutlinePages loop) is generalised to ALL types so
 * large collections (story entities, outline) never silently truncate.
 */

import { useQuery } from '@tanstack/react-query';
import { unifiedObjectService } from '../../api/unifiedObjectService';
import { objectKeys, type ObjectRichTextFormat } from '../keys/objectKeys';
import { defaultRichTextFormatForType } from '../../domain/objectFormat';
import type { ObjectType, UnifiedObject } from '../../types/unifiedObject';

const PAGE_SIZE = 100;

/** Fetch every page of a project's object collection of one type. */
export async function fetchObjectCollection(
  projectId: string,
  type: ObjectType,
  language: string,
  format: ObjectRichTextFormat,
  summary = false,
): Promise<UnifiedObject[]> {
  const all: UnifiedObject[] = [];
  let page = 1;
  let total = 0;

  do {
    const res = await unifiedObjectService.listObjects(type, projectId, {
      language,
      rich_text_format: format,
      page,
      page_size: PAGE_SIZE,
      include_content: summary ? false : undefined,
    });
    total = res.total;
    all.push(...res.objects);
    page += 1;
  } while (all.length < total);

  return all;
}

/**
 * @param summary When true, fetch the lightweight projection (no rich-text
 *   `content`/`authorNote`) — for callers that only need labels/metadata.
 *   Cached under a separate query-key variant so it never collides with the
 *   full-content collection.
 */
export function useObjectCollectionQuery(
  projectId: string | undefined,
  type: ObjectType,
  language: string,
  format?: ObjectRichTextFormat,
  summary = false,
) {
  const fmt = format ?? defaultRichTextFormatForType(type);
  return useQuery({
    queryKey: objectKeys.collection(projectId ?? '__none__', type, language, fmt, summary ? 'summary' : 'full'),
    queryFn: () => fetchObjectCollection(projectId as string, type, language, fmt, summary),
    enabled: Boolean(projectId),
  });
}

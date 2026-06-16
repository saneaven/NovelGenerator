/**
 * Version history queries.
 * - useObjectVersionsQuery: metadata-only list (the version-history modal list).
 * - useObjectVersionQuery: a single version's full content (lazy, on expand).
 */

import { useQuery } from '@tanstack/react-query';
import { unifiedObjectService } from '../../api/unifiedObjectService';
import { objectKeys } from '../keys/objectKeys';
import type { ObjectType, RichTextFormat } from '../../types/unifiedObject';

export function useObjectVersionsQuery(
  type: ObjectType,
  id: string | undefined,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: objectKeys.versions(type, id ?? '__none__'),
    queryFn: () => unifiedObjectService.getVersions(type, id as string),
    enabled: Boolean(id) && enabled,
  });
}

export function useObjectVersionQuery(
  type: ObjectType,
  id: string | undefined,
  versionId: string | undefined,
  richTextFormat: RichTextFormat = 'markdown',
) {
  return useQuery({
    queryKey: objectKeys.version(type, id ?? '__none__', versionId ?? '__none__'),
    queryFn: () => unifiedObjectService.getVersion(type, id as string, versionId as string, richTextFormat),
    enabled: Boolean(id) && Boolean(versionId),
  });
}

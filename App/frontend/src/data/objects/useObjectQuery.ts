/** Query for a single object's detail in a language + rich-text format. */

import { useQuery } from '@tanstack/react-query';
import { unifiedObjectService } from '../../api/unifiedObjectService';
import { objectKeys, type ObjectRichTextFormat } from '../keys/objectKeys';
import { defaultRichTextFormatForType } from '../../domain/objectFormat';
import type { ObjectType } from '../../types/unifiedObject';

export interface UseObjectQueryOptions {
  format?: ObjectRichTextFormat;
  /** Per-query staleTime override (e.g. Infinity while an editor owns the buffer). */
  staleTime?: number;
  refetchOnMount?: boolean | 'always';
  enabled?: boolean;
}

export function useObjectQuery(
  type: ObjectType,
  id: string | undefined,
  language: string,
  options?: ObjectRichTextFormat | UseObjectQueryOptions,
) {
  const opts: UseObjectQueryOptions = typeof options === 'string' ? { format: options } : (options ?? {});
  const fmt = opts.format ?? defaultRichTextFormatForType(type);
  return useQuery({
    queryKey: objectKeys.detail(type, id ?? '__none__', language, fmt),
    queryFn: () => unifiedObjectService.getObject(type, id as string, language, fmt),
    enabled: (opts.enabled ?? true) && Boolean(id),
    staleTime: opts.staleTime,
    refetchOnMount: opts.refetchOnMount,
  });
}

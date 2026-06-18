/**
 * Fetch the FULL-content data of a tool-call operation's target object (single
 * detail query, markdown format), for cards that must render or diff the body.
 *
 * The project objects map (`useProjectObjectsMap`) is now the lightweight
 * SUMMARY projection (no rich-text body), so cards use it only for
 * titles/metadata/labels. Body content and field diffs come from here — a
 * single object fetch scoped to the one target, never the whole project.
 *
 * Returns `undefined` while loading, for non-resolvable types (e.g. timeline,
 * which renders via its own lookup), or when there is no target id.
 */

import { useObjectQuery } from '../../../data/objects/useObjectQuery';
import { resolveUnifiedType } from './helpers';
import type { ObjectOperationVM } from '../vmTypes';

export function useTargetObjectData(
  operation: ObjectOperationVM,
  language: string,
): Record<string, unknown> | undefined {
  const unifiedType = resolveUnifiedType(operation);
  const id = operation.targetId;
  const query = useObjectQuery(
    unifiedType ?? 'basic_info',
    unifiedType && id ? id : undefined,
    language,
    { format: 'markdown' },
  );
  return query.data?.data as Record<string, unknown> | undefined;
}

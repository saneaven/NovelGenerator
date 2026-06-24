/**
 * SSE → QueryClient bridge for unified objects.
 *
 * Object change events are language-agnostic. A changed object makes every
 * cached language/format projection stale, so this bridge invalidates by object
 * identity instead of patching one currently displayed language into cache.
 */

import { queryClient } from '../queryClient';
import { objectKeys } from '../keys/objectKeys';
import { isStoryEntityTreeType } from '../../domain/objectFormat';
import type { ObjectType } from '../../types/unifiedObject';

export type ObjectChangeAction = 'created' | 'updated' | 'deleted';

/** Invalidate every cached projection affected by one changed object. */
export async function invalidateObjectFromSSE(params: {
  type: ObjectType;
  id: string;
  projectId: string;
  action: ObjectChangeAction;
}): Promise<void> {
  const { type, id, projectId } = params;
  queryClient.removeQueries({ queryKey: objectKeys.detailOf(type, id) });
  const collectionPromise = queryClient.invalidateQueries({
    queryKey: isStoryEntityTreeType(type)
      ? objectKeys.storyTreesOf(projectId)
      : objectKeys.collectionType(projectId, type),
  });
  const versionsPromise = queryClient.invalidateQueries({ queryKey: objectKeys.versions(type, id) });
  await Promise.all([collectionPromise, versionsPromise]);
}

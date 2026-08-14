import { useCallback, useMemo } from 'react';
import { useAuthStore } from '../../store/authStore';
import {
  getEffectiveSharedSelection,
  useObjectPickerSelectionStore,
  type ObjectPickerSelectionBucket,
  type SharedSelectionUpdate,
} from '../../store/objectPickerSelectionStore';
import type { UnifiedObject } from '../../types/unifiedObject';

const EMPTY_IDS: readonly string[] = [];

export interface UseSharedObjectPickerSelectionOptions {
  projectId: string | null | undefined;
  bucket: ObjectPickerSelectionBucket;
  availableIds: readonly string[];
  excludedIds?: readonly string[];
  preSelectedIds?: readonly string[];
}

export interface UseSharedObjectPickerSelectionResult {
  selectedIds: string[];
  setSelectedIds: (next: SharedSelectionUpdate) => void;
}

/**
 * A controlled-ObjectPicker adapter backed by the persisted shared selection
 * store. The signed-in user, project, and explicit bucket form the isolation
 * boundary.
 */
export function useSharedObjectPickerSelection({
  projectId,
  bucket,
  availableIds,
  excludedIds = EMPTY_IDS,
  preSelectedIds = EMPTY_IDS,
}: UseSharedObjectPickerSelectionOptions): UseSharedObjectPickerSelectionResult {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const replaceSelectionSlice = useObjectPickerSelectionStore(
    (state) => state.replaceSelectionSlice,
  );
  const storedIds = useObjectPickerSelectionStore((state) => {
    if (!userId || !projectId) return EMPTY_IDS;
    return state.selections[userId]?.[projectId]?.[bucket] ?? EMPTY_IDS;
  });

  const selectedIds = useMemo(() => {
    if (!userId || !projectId) return [];
    return getEffectiveSharedSelection(
      storedIds,
      availableIds,
      excludedIds,
      preSelectedIds,
    );
  }, [availableIds, excludedIds, preSelectedIds, projectId, storedIds, userId]);

  const setSelectedIds = useCallback((next: SharedSelectionUpdate) => {
    if (!userId || !projectId) return;
    replaceSelectionSlice({
      userId,
      projectId,
      bucket,
      availableIds,
      excludedIds,
      preSelectedIds,
      nextSelectedIds: next,
    });
  }, [availableIds, bucket, excludedIds, preSelectedIds, projectId, replaceSelectionSlice, userId]);

  return { selectedIds, setSelectedIds };
}

/** Selectable object IDs exposed by ObjectPicker's `all` mode. */
export function getAllModeSelectableIds(objects: readonly UnifiedObject[]): string[] {
  const ids = new Set<string>();

  for (const object of objects) {
    const selectable = object.type === 'story_entity'
      || object.type === 'manuscript'
      || object.type === 'timeline_track'
      || object.type === 'timeline_event'
      || (object.type === 'outline' && object.kind === 'chapter');
    if (selectable) ids.add(object.id);
  }

  return Array.from(ids);
}

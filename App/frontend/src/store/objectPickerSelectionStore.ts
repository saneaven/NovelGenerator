import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

export type ObjectPickerSelectionBucket =
  | 'all-context'
  | 'translation-target'
  | 'translation-context';

type BucketSelections = Partial<Record<ObjectPickerSelectionBucket, string[]>>;
type ProjectSelections = Record<string, BucketSelections>;

export type ObjectPickerSelections = Record<string, ProjectSelections>;

export type SharedSelectionValue = string[] | string;
export type SharedSelectionUpdate = SharedSelectionValue
  | ((current: string[]) => SharedSelectionValue);

interface ReplaceSelectionSliceInput {
  userId: string;
  projectId: string;
  bucket: ObjectPickerSelectionBucket;
  availableIds: readonly string[];
  excludedIds?: readonly string[];
  preSelectedIds?: readonly string[];
  nextSelectedIds: SharedSelectionUpdate;
}

interface ObjectPickerSelectionStore {
  selections: ObjectPickerSelections;
  replaceSelectionSlice: (input: ReplaceSelectionSliceInput) => void;
  clearProject: (userId: string, projectId: string) => void;
}

const EMPTY_IDS: readonly string[] = [];

function uniqueIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Derive the call-local selection. Persisted IDs that are unavailable (stale or
 * hidden by the current language/filter) and excluded edit targets are never
 * exposed to the picker or request payload. preSelectedIds are included only
 * in this derived value and are not written to storage.
 */
export function getEffectiveSharedSelection(
  storedIds: readonly string[],
  availableIds: readonly string[],
  excludedIds: readonly string[] = EMPTY_IDS,
  preSelectedIds: readonly string[] = EMPTY_IDS,
): string[] {
  const selectedSet = new Set([...storedIds, ...preSelectedIds]);
  const excludedSet = new Set(excludedIds);

  return uniqueIds(availableIds).filter(
    (id) => selectedSet.has(id) && !excludedSet.has(id),
  );
}

/**
 * Replace only the editable part of a bucket. IDs outside availableIds are
 * preserved for language/filter round trips, and excluded IDs retain their
 * previous persisted membership. preSelectedIds can be displayed as selected
 * but are never added to persistence by this update.
 */
export function replaceSharedSelectionSlice(
  storedIds: readonly string[],
  availableIds: readonly string[],
  excludedIds: readonly string[] = EMPTY_IDS,
  preSelectedIds: readonly string[] = EMPTY_IDS,
  nextSelectedIds: readonly string[],
): string[] {
  const availableSet = new Set(availableIds);
  const excludedSet = new Set(excludedIds);
  const preSelectedSet = new Set(preSelectedIds);
  const editableSet = new Set(
    uniqueIds(availableIds).filter(
      (id) => !excludedSet.has(id) && !preSelectedSet.has(id),
    ),
  );

  const preserved = uniqueIds(storedIds).filter(
    (id) => !availableSet.has(id) || excludedSet.has(id) || preSelectedSet.has(id),
  );
  const replacement = uniqueIds(nextSelectedIds).filter(
    (id) => editableSet.has(id),
  );

  return [...preserved, ...replacement];
}

export const useObjectPickerSelectionStore = create<ObjectPickerSelectionStore>()(
  persist(
    (set) => ({
      selections: {},

      replaceSelectionSlice: ({
        userId,
        projectId,
        bucket,
        availableIds,
        excludedIds = EMPTY_IDS,
        preSelectedIds = EMPTY_IDS,
        nextSelectedIds,
      }) => {
        if (!userId || !projectId) return;

        set((state) => {
          const storedIds = state.selections[userId]?.[projectId]?.[bucket] ?? EMPTY_IDS;
          const currentIds = getEffectiveSharedSelection(
            storedIds,
            availableIds,
            excludedIds,
            preSelectedIds,
          );
          const resolvedSelection = typeof nextSelectedIds === 'function'
            ? nextSelectedIds(currentIds)
            : nextSelectedIds;
          const resolvedIds = Array.isArray(resolvedSelection)
            ? resolvedSelection
            : resolvedSelection
              ? [resolvedSelection]
              : [];
          const nextIds = replaceSharedSelectionSlice(
            storedIds,
            availableIds,
            excludedIds,
            preSelectedIds,
            resolvedIds,
          );

          if (arraysEqual(storedIds, nextIds)) return state;

          return {
            selections: {
              ...state.selections,
              [userId]: {
                ...state.selections[userId],
                [projectId]: {
                  ...state.selections[userId]?.[projectId],
                  [bucket]: nextIds,
                },
              },
            },
          };
        });
      },

      clearProject: (userId, projectId) => {
        if (!userId || !projectId) return;

        set((state) => {
          const userSelections = state.selections[userId];
          if (!userSelections?.[projectId]) return state;

          const nextUserSelections = { ...userSelections };
          delete nextUserSelections[projectId];

          const nextSelections = { ...state.selections };
          if (Object.keys(nextUserSelections).length === 0) {
            delete nextSelections[userId];
          } else {
            nextSelections[userId] = nextUserSelections;
          }

          return { selections: nextSelections };
        });
      },
    }),
    {
      name: 'object-picker-selections',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ selections: state.selections }),
    },
  ),
);

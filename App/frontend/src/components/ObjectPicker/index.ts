/**
 * ObjectPicker - Unified component for selecting objects
 *
 * Usage:
 * ```tsx
 * import { ObjectPicker } from './components/ObjectPicker';
 *
 * <ObjectPicker
 *   mode="all"
 *   selectionMode="multi"
 *   selectedIds={selectedIds}
 *   onChange={setSelectedIds}
 *   projectId={projectId}
 *   language={language}
 * />
 * ```
 */

export { default as ObjectPicker } from './ObjectPicker';
export { default as ObjectPickerGroup } from './ObjectPickerGroup';
export { default as ObjectPickerItem } from './ObjectPickerItem';
export { default as ObjectPickerSearch } from './ObjectPickerSearch';
export { useObjectPickerData } from './useObjectPickerData';
export {
  getAllModeSelectableIds,
  useSharedObjectPickerSelection,
} from './useSharedObjectPickerSelection';
export type {
  UseSharedObjectPickerSelectionOptions,
  UseSharedObjectPickerSelectionResult,
} from './useSharedObjectPickerSelection';
export type { ObjectPickerSelectionBucket } from '../../store/objectPickerSelectionStore';
export * from './types';

/**
 * ObjectPicker - Unified component for selecting story objects
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
export { default as ObjectPickerPreview } from './ObjectPickerPreview';
export { default as ObjectPickerSearch } from './ObjectPickerSearch';
export { useObjectPickerData } from './useObjectPickerData';
export * from './types';

/**
 * TypeScript interfaces for the unified ObjectPicker component
 */

import type { ObjectType } from '../../types/unifiedObject';

// ============================================================================
// OBJECT PICKER TYPES
// ============================================================================

/** Display modes for the ObjectPicker */
export type ObjectPickerMode = 'story-objects' | 'manuscript' | 'all';

/** Selection modes */
export type SelectionMode = 'single' | 'multi';

/** Selection state for checkboxes */
export type SelectionState = 'checked' | 'unchecked' | 'indeterminate';

/** Story object types (excludes manuscript/chapter/act structure) */
export type StoryObjectType = 'basic_info' | 'character' | 'organization' | 'location' | 'lorebook';

/** Outline structure types */
export type OutlineObjectType = 'act' | 'chapter' | 'manuscript';

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/** Normalized item for display */
export interface ObjectPickerItem {
  id: string;
  name: string;
  description?: string;
  type: ObjectType;
  parentId?: string;         // act_id for chapters, chapter_id for manuscripts
  order?: number;
  wordCount?: number;        // For manuscripts
  metadata?: Record<string, unknown>;
}

/** Group structure */
export interface ObjectPickerGroup {
  id: string;
  label: string;
  type: ObjectType | 'act';
  items: ObjectPickerItem[];
  childGroups?: ObjectPickerGroup[];  // For acts containing chapters
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

/** Props for ObjectPicker */
export interface ObjectPickerProps {
  mode: ObjectPickerMode;
  selectionMode: SelectionMode;
  selectedIds: string[] | string;
  onChange: (ids: string[] | string) => void;
  projectId: string;
  language: string;

  // Optional features
  showPreview?: boolean;
  previewPosition?: 'side' | 'modal';
  excludeTypes?: ObjectType[];
  filterIds?: string[];            // If provided, only show items with these IDs
  preSelectedIds?: string[];       // IDs that cannot be deselected
  highlightIds?: string[];         // IDs to highlight (e.g., current chapter)
  excludedIds?: string[];          // IDs shown without checkbox (edit targets, excluded from selection)
  disabled?: boolean;
  loading?: boolean;

  // Custom data mode - bypass store fetching
  customGroups?: ObjectPickerGroup[];  // If provided, use these instead of fetching from store

  // Callbacks
  onLoadComplete?: () => void;

  // Customization
  maxHeight?: string | number;
  className?: string;
  emptyMessage?: string;
  showSearch?: boolean;            // Whether to show search bar (default: true)
}

/** Props for ObjectPickerGroup */
export interface ObjectPickerGroupProps {
  group: ObjectPickerGroup;
  selectionMode: SelectionMode;
  selectedIds: Set<string>;
  expandedGroups: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleGroup: (groupId: string, select: boolean) => void;
  onToggleExpand: (groupId: string) => void;
  preSelectedIds: Set<string>;
  highlightIds: Set<string>;       // IDs to highlight
  excludedIds: Set<string>;        // IDs excluded from selection (edit targets)
  disabled?: boolean;
  level?: number;  // Nesting level for indentation
}

/** Props for ObjectPickerItem */
export interface ObjectPickerItemProps {
  item: ObjectPickerItem;
  isSelected: boolean;
  isPreSelected?: boolean;
  isHighlighted?: boolean;         // Whether to highlight this item
  isExcluded?: boolean;            // Whether this item is an edit target (no checkbox)
  selectionMode: SelectionMode;
  onToggle: (id: string) => void;
  disabled?: boolean;
}

/** Props for ObjectPickerSearch */
export interface ObjectPickerSearchProps {
  value: string;
  onChange: (value: string) => void;
  typeFilter?: ObjectType | null;
  onTypeFilterChange?: (type: ObjectType | null) => void;
  availableTypes?: ObjectType[];
  placeholder?: string;
}

/** Props for ObjectPickerPreview */
export interface ObjectPickerPreviewProps {
  item: ObjectPickerItem | null;
  position: 'side' | 'modal';
  onClose?: () => void;
  language: string;
  projectId: string;
}

// ============================================================================
// HOOK TYPES
// ============================================================================

/** Options for useObjectPickerData hook */
export interface UseObjectPickerDataOptions {
  projectId: string;
  language: string;
  mode: ObjectPickerMode;
  excludeTypes?: ObjectType[];
}

/** Result from useObjectPickerData hook */
export interface UseObjectPickerDataResult {
  groups: ObjectPickerGroup[];
  availableTypes: ObjectType[];
  isLoading: boolean;
  error: string | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Category display names and order */
export const CATEGORY_CONFIG: Record<string, { label: string; order: number }> = {
  basic_info: { label: 'Basic Info', order: 0 },
  character: { label: 'Characters', order: 1 },
  organization: { label: 'Organizations', order: 2 },
  location: { label: 'Locations', order: 3 },
  lorebook: { label: 'Lorebook', order: 4 },
  act: { label: 'Acts', order: 5 },
  chapter: { label: 'Chapters', order: 6 },
  manuscript: { label: 'Manuscripts', order: 7 },
};

/**
 * TypeScript interfaces for the unified ObjectPicker component
 */

import type { AnyObjectType, ObjectType, OutlineKind } from '../../types/unifiedObject';

// ============================================================================
// OBJECT PICKER TYPES
// ============================================================================

/** Display modes for the ObjectPicker */
export type ObjectPickerMode = 'story-entities' | 'manuscript' | 'all' | 'translation';

/** Selection modes */
export type SelectionMode = 'single' | 'multi';

/** Selection state for checkboxes */
export type SelectionState = 'checked' | 'unchecked' | 'indeterminate';

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/** Normalized item for display */
export interface ObjectPickerItem {
  id: string;
  name: string;
  description?: string;      // One-line summary for object indexes
  type: AnyObjectType;
  kind?: OutlineKind;
  parentId?: string;
  order?: number;
  wordCount?: number;        // For manuscripts
  isStructural?: boolean;    // Structural-only item (no checkbox, not selectable)
  isGroupParent?: boolean;   // Parent object shown as item in its own group (sorts first)
  metadata?: Record<string, unknown>;
}

/** Group structure */
export interface ObjectPickerGroup {
  id: string;
  label: string;
  description?: string;
  type: AnyObjectType;
  kind?: OutlineKind;
  order?: number;
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
  selectAllOnLoad?: boolean;     // If true, select all items when loading completes
  showSelectAll?: boolean;       // If true, show select all toggle header

  // Customization
  maxHeight?: string | number;
  className?: string;
  emptyMessage?: string;
  showSearch?: boolean;            // Whether to show search bar (default: true)
  showTokenCount?: boolean;        // Whether to show total token count of selected items
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
  isStructural?: boolean;          // Structural-only item (label only, no checkbox, no badge)
  selectionMode: SelectionMode;
  onToggle: (id: string) => void;
  disabled?: boolean;
}

/** Props for ObjectPickerSearch */
export interface ObjectPickerSearchProps {
  value: string;
  onChange: (value: string) => void;
  typeFilter?: AnyObjectType | null;
  onTypeFilterChange?: (type: AnyObjectType | null) => void;
  availableTypes?: AnyObjectType[];
  placeholder?: string;
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
  availableTypes: AnyObjectType[];
  isLoading: boolean;
  error: string | null;
}

// ============================================================================
// CONSTANTS
// ============================================================================

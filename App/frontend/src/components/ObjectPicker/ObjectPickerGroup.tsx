/**
 * Collapsible group component for ObjectPicker
 * Minimal inline header design: chevron + name | checkbox + count
 */

import React, { useCallback, useMemo } from 'react';
import { ChevronRight } from '../icons';
import ObjectPickerItem from './ObjectPickerItem';
import type { ObjectPickerGroupProps, ObjectPickerGroup as PickerGroup, SelectionState, ObjectPickerItem as PickerItem } from './types';

interface GroupLike {
  items: PickerItem[];
  childGroups?: GroupLike[];
}

/**
 * Get all selectable item IDs from a group (recursively including all nested levels).
 * Structural items are excluded since they are not selectable.
 */
function getAllItemIds(group: GroupLike): string[] {
  const ids: string[] = group.items
    .filter(item => !item.isStructural)
    .map(item => item.id);

  if (group.childGroups) {
    group.childGroups.forEach(childGroup => {
      ids.push(...getAllItemIds(childGroup));
    });
  }

  return ids;
}

type MergedChild =
  | { kind: 'item'; data: PickerItem; order: number; label: string }
  | { kind: 'group'; data: PickerGroup; order: number; label: string };

function mergedChildren(items: PickerItem[], childGroups?: PickerGroup[]): MergedChild[] {
  const merged: MergedChild[] = [];
  for (const item of items) {
    if (item.isStructural) continue; // structural items are not rendered as rows
    merged.push({ kind: 'item', data: item, order: item.order ?? 0, label: item.name });
  }
  if (childGroups) {
    for (const group of childGroups) {
      merged.push({ kind: 'group', data: group, order: group.order ?? 0, label: group.label });
    }
  }
  merged.sort((a, b) => {
    // Parent items (isGroupParent) always sort first
    const aParent = a.kind === 'item' && a.data.isGroupParent ? 1 : 0;
    const bParent = b.kind === 'item' && b.data.isGroupParent ? 1 : 0;
    if (aParent !== bParent) return bParent - aParent;
    if (a.order !== b.order) return a.order - b.order;
    return a.label.localeCompare(b.label);
  });
  return merged;
}

const ObjectPickerGroup: React.FC<ObjectPickerGroupProps> = ({
  group,
  selectionMode,
  selectedIds,
  expandedGroups,
  onToggleItem,
  onToggleGroup,
  onToggleExpand,
  preSelectedIds,
  highlightIds,
  excludedIds,
  disabled = false,
  level = 0,
}) => {
  const isExpanded = expandedGroups.has(group.id);

  // Calculate selection state (excluding excludedIds from calculation)
  const selectionState = useMemo((): SelectionState => {
    const allIds = getAllItemIds(group).filter(id => !excludedIds.has(id));
    if (allIds.length === 0) return 'unchecked';

    const selectedCount = allIds.filter(id => selectedIds.has(id)).length;
    if (selectedCount === 0) return 'unchecked';
    if (selectedCount === allIds.length) return 'checked';
    return 'indeterminate';
  }, [group, selectedIds, excludedIds]);

  // Count selected items (excluding excludedIds from calculation)
  const { selectedCount, totalCount } = useMemo(() => {
    const allIds = getAllItemIds(group).filter(id => !excludedIds.has(id));
    return {
      selectedCount: allIds.filter(id => selectedIds.has(id)).length,
      totalCount: allIds.length,
    };
  }, [group, selectedIds, excludedIds]);

  const handleHeaderClick = useCallback(() => {
    onToggleExpand(group.id);
  }, [group.id, onToggleExpand]);

  const handleCheckboxClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  const handleCheckboxChange = useCallback(() => {
    if (disabled || selectionMode === 'single') return;
    // Toggle to opposite of current majority state
    const shouldSelect = selectionState !== 'checked';
    onToggleGroup(group.id, shouldSelect);
  }, [group.id, selectionState, onToggleGroup, disabled, selectionMode]);

  // Set indeterminate state on checkbox
  const checkboxRef = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.indeterminate = selectionState === 'indeterminate';
    }
  }, [selectionState]);

  const groupClasses = [
    'object-picker-group',
    isExpanded && 'expanded',
  ].filter(Boolean).join(' ');

  const headerClasses = [
    'object-picker-group-header',
    level > 0 && 'nested',
  ].filter(Boolean).join(' ');

  return (
    <div className={groupClasses}>
      <div className={headerClasses} onClick={handleHeaderClick}>
        {/* Chevron icon */}
        <span className="object-picker-group-chevron">
          <ChevronRight size="sm" />
        </span>

        {/* Group name */}
        <span className="object-picker-group-name" title={group.description || group.label}>{group.label}</span>

        {/* Count and checkbox (right side) */}
        {selectionMode === 'multi' && (
          <div className="object-picker-group-checkbox" onClick={handleCheckboxClick}>
            <span className="object-picker-group-count">
              {selectedCount}/{totalCount}
            </span>
            <input
              type="checkbox"
              ref={checkboxRef}
              checked={selectionState === 'checked'}
              onChange={handleCheckboxChange}
              disabled={disabled}
              aria-label={`Select all in ${group.label}`}
            />
          </div>
        )}

        {/* Count only for single select mode */}
        {selectionMode === 'single' && (
          <span className="object-picker-group-count">
            {totalCount}
          </span>
        )}
      </div>

      {/* Items container - only render when expanded */}
      {isExpanded && (
        <div className="object-picker-items">
          {/* Merge items and child groups, sort by display_order then name */}
          {mergedChildren(group.items, group.childGroups).map(child =>
            child.kind === 'item' ? (
              <ObjectPickerItem
                key={child.data.id}
                item={child.data}
                isSelected={selectedIds.has(child.data.id)}
                isPreSelected={preSelectedIds.has(child.data.id)}
                isHighlighted={highlightIds.has(child.data.id)}
                isExcluded={excludedIds.has(child.data.id)}
                isStructural={child.data.isStructural}
                selectionMode={selectionMode}
                onToggle={onToggleItem}
                disabled={disabled}
              />
            ) : (
              <ObjectPickerGroup
                key={child.data.id}
                group={child.data}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                expandedGroups={expandedGroups}
                onToggleItem={onToggleItem}
                onToggleGroup={onToggleGroup}
                onToggleExpand={onToggleExpand}
                preSelectedIds={preSelectedIds}
                highlightIds={highlightIds}
                excludedIds={excludedIds}
                disabled={disabled}
                level={level + 1}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
};

export default ObjectPickerGroup;

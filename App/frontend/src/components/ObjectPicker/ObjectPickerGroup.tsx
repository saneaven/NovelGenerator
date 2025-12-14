/**
 * Collapsible group component for ObjectPicker
 * Minimal inline header design: chevron + name | checkbox + count
 */

import React, { useCallback, useMemo } from 'react';
import { ChevronRight } from '../icons';
import ObjectPickerItem from './ObjectPickerItem';
import type { ObjectPickerGroupProps, SelectionState, ObjectPickerItem as PickerItem } from './types';

/**
 * Get all item IDs from a group (including nested groups)
 */
function getAllItemIds(group: { items: PickerItem[]; childGroups?: { items: PickerItem[] }[] }): string[] {
  const ids: string[] = group.items.map(item => item.id);

  if (group.childGroups) {
    group.childGroups.forEach(childGroup => {
      ids.push(...childGroup.items.map(item => item.id));
    });
  }

  return ids;
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
  disabled = false,
  level = 0,
}) => {
  const isExpanded = expandedGroups.has(group.id);

  // Calculate selection state
  const selectionState = useMemo((): SelectionState => {
    const allIds = getAllItemIds(group);
    if (allIds.length === 0) return 'unchecked';

    const selectedCount = allIds.filter(id => selectedIds.has(id)).length;
    if (selectedCount === 0) return 'unchecked';
    if (selectedCount === allIds.length) return 'checked';
    return 'indeterminate';
  }, [group, selectedIds]);

  // Count selected items
  const { selectedCount, totalCount } = useMemo(() => {
    const allIds = getAllItemIds(group);
    return {
      selectedCount: allIds.filter(id => selectedIds.has(id)).length,
      totalCount: allIds.length,
    };
  }, [group, selectedIds]);

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
          <ChevronRight size={14} />
        </span>

        {/* Group name */}
        <span className="object-picker-group-name">{group.label}</span>

        {/* Checkbox with count (right side) */}
        {selectionMode === 'multi' && (
          <div className="object-picker-group-checkbox" onClick={handleCheckboxClick}>
            <input
              type="checkbox"
              ref={checkboxRef}
              checked={selectionState === 'checked'}
              onChange={handleCheckboxChange}
              disabled={disabled}
              aria-label={`Select all in ${group.label}`}
            />
            <span className="object-picker-group-count">
              {selectedCount}/{totalCount}
            </span>
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
          {/* Render direct items */}
          {group.items.map(item => (
            <ObjectPickerItem
              key={item.id}
              item={item}
              isSelected={selectedIds.has(item.id)}
              isPreSelected={preSelectedIds.has(item.id)}
              isHighlighted={highlightIds.has(item.id)}
              selectionMode={selectionMode}
              onToggle={onToggleItem}
              disabled={disabled}
            />
          ))}

          {/* Render nested groups (acts containing chapters) */}
          {group.childGroups?.map(childGroup => (
            <ObjectPickerGroup
              key={childGroup.id}
              group={childGroup}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              expandedGroups={expandedGroups}
              onToggleItem={onToggleItem}
              onToggleGroup={onToggleGroup}
              onToggleExpand={onToggleExpand}
              preSelectedIds={preSelectedIds}
              highlightIds={highlightIds}
              disabled={disabled}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ObjectPickerGroup;

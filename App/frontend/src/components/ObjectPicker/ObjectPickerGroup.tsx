/**
 * Collapsible group component for ObjectPicker
 * Minimal inline header design: chevron + name | checkbox + count
 */

import React, { useCallback, useMemo } from 'react';
import { ChevronRight } from '../icons';
import ObjectPickerItem from './ObjectPickerItem';
import type { ObjectPickerGroupProps, SelectionState, ObjectPickerItem as PickerItem } from './types';

interface GroupLike {
  items: PickerItem[];
  childGroups?: GroupLike[];
}

/**
 * Get all item IDs from a group (recursively including all nested levels)
 */
function getAllItemIds(group: GroupLike): string[] {
  const ids: string[] = group.items.map(item => item.id);

  if (group.childGroups) {
    group.childGroups.forEach(childGroup => {
      ids.push(...getAllItemIds(childGroup));
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
        <span className="object-picker-group-name">{group.label}</span>

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
          {/* Render direct items */}
          {group.items.map(item => (
            <ObjectPickerItem
              key={item.id}
              item={item}
              isSelected={selectedIds.has(item.id)}
              isPreSelected={preSelectedIds.has(item.id)}
              isHighlighted={highlightIds.has(item.id)}
              isExcluded={excludedIds.has(item.id)}
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
              excludedIds={excludedIds}
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

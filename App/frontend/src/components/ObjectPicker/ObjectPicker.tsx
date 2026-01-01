/**
 * Unified ObjectPicker Component
 *
 * A reusable component for selecting story objects across different modals.
 * Supports three modes:
 * - story-objects: Characters, Locations, Organizations, Lorebook
 * - manuscript: Acts and Chapters (manuscripts)
 * - all: Both story objects and manuscripts
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { ObjectType } from '../../types/unifiedObject';
import ObjectPickerSearch from './ObjectPickerSearch';
import ObjectPickerGroup from './ObjectPickerGroup';
import ObjectPickerPreview from './ObjectPickerPreview';
import { useObjectPickerData } from './useObjectPickerData';
import type { ObjectPickerProps, ObjectPickerItem as PickerItem, ObjectPickerGroup as Group } from './types';
import './ObjectPicker.css';

/**
 * Filter groups to only include items with IDs in the filterIds set
 * Recursively handles all levels of nested childGroups
 */
function filterGroupsByIds(groups: Group[], filterIds: Set<string>): Group[] {
  return groups
    .map(group => {
      // Filter items by ID
      const filteredItems = group.items.filter(item => filterIds.has(item.id));

      // Recursively filter child groups
      const filteredChildGroups = group.childGroups
        ? filterGroupsByIds(group.childGroups, filterIds)
        : undefined;

      // Include group if it has matching items or filtered child groups with content
      const hasItems = filteredItems.length > 0;
      const hasChildGroups = filteredChildGroups && filteredChildGroups.length > 0;

      if (!hasItems && !hasChildGroups) {
        return null;
      }

      return {
        ...group,
        items: filteredItems,
        childGroups: hasChildGroups ? filteredChildGroups : undefined,
      };
    })
    .filter(Boolean) as Group[];
}

/**
 * Get all item IDs from groups (including deeply nested child groups)
 */
function getAllItemIds(groups: Group[]): string[] {
  const ids: string[] = [];

  function collectIds(group: Group) {
    ids.push(...group.items.map(item => item.id));
    if (group.childGroups) {
      group.childGroups.forEach(childGroup => collectIds(childGroup));
    }
  }

  groups.forEach(group => collectIds(group));
  return ids;
}

/**
 * Find a group by ID (recursively searching all nested levels)
 */
function findGroup(groups: Group[], groupId: string): Group | null {
  for (const group of groups) {
    if (group.id === groupId) return group;
    if (group.childGroups) {
      const found = findGroup(group.childGroups, groupId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Filter groups based on search query and type filter
 */
function filterGroups(
  groups: Group[],
  searchQuery: string,
  typeFilter: ObjectType | null
): Group[] {
  if (!searchQuery && !typeFilter) return groups;

  const normalizedQuery = searchQuery.toLowerCase().trim();

  return groups
    .map(group => {
      // Filter by type
      if (typeFilter && group.type !== typeFilter && group.type !== 'act') {
        // Allow 'act' groups through when filtering by manuscript
        if (!(typeFilter === 'manuscript' && group.type === 'manuscript')) {
          return null;
        }
      }

      // Filter items by search query
      const filteredItems = group.items.filter(item => {
        const matchesSearch = !normalizedQuery ||
          item.name.toLowerCase().includes(normalizedQuery) ||
          item.description?.toLowerCase().includes(normalizedQuery);
        const matchesType = !typeFilter || item.type === typeFilter;
        return matchesSearch && matchesType;
      });

      // Filter child groups
      const filteredChildGroups = group.childGroups?.map(childGroup => {
        const childFilteredItems = childGroup.items.filter(item => {
          const matchesSearch = !normalizedQuery ||
            item.name.toLowerCase().includes(normalizedQuery) ||
            item.description?.toLowerCase().includes(normalizedQuery);
          return matchesSearch;
        });

        if (childFilteredItems.length === 0) return null;

        return {
          ...childGroup,
          items: childFilteredItems,
        };
      }).filter(Boolean) as Group[] | undefined;

      // Include group if it has matching items or child groups
      const hasItems = filteredItems.length > 0;
      const hasChildGroups = filteredChildGroups && filteredChildGroups.length > 0;

      if (!hasItems && !hasChildGroups) return null;

      return {
        ...group,
        items: filteredItems,
        childGroups: filteredChildGroups,
      };
    })
    .filter(Boolean) as Group[];
}

const ObjectPicker: React.FC<ObjectPickerProps> = ({
  mode,
  selectionMode,
  selectedIds,
  onChange,
  projectId,
  language,
  showPreview = false,
  previewPosition = 'side',
  excludeTypes = [],
  filterIds,
  preSelectedIds = [],
  highlightIds = [],
  excludedIds = [],
  disabled = false,
  loading: externalLoading,
  customGroups,
  onLoadComplete,
  selectAllOnLoad = false,
  maxHeight = '400px',
  className = '',
  emptyMessage = 'No objects available',
  showSearch = true,
}) => {
  // Internal state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ObjectType | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<PickerItem | null>(null);
  const hasInitializedSelectionRef = useRef(false);

  // Data fetching hook (only used when customGroups is not provided)
  const { groups: fetchedGroups, availableTypes: fetchedTypes, isLoading: fetchLoading, error } = useObjectPickerData({
    projectId,
    language,
    mode,
    excludeTypes,
  });

  // Use custom groups if provided, otherwise use fetched groups
  const baseGroups = customGroups ?? fetchedGroups;
  const availableTypes = customGroups ? [] : fetchedTypes;
  const isLoading = customGroups ? false : fetchLoading;

  // Apply filterIds filtering if provided
  const groups = useMemo(() => {
    if (!filterIds || filterIds.length === 0) return baseGroups;
    return filterGroupsByIds(baseGroups, new Set(filterIds));
  }, [baseGroups, filterIds]);

  // Notify when loading completes
  useEffect(() => {
    if (!isLoading && onLoadComplete) {
      onLoadComplete();
    }
  }, [isLoading, onLoadComplete]);

  // Derived state
  const selectedIdSet = useMemo(() => {
    if (Array.isArray(selectedIds)) {
      return new Set(selectedIds);
    }
    return new Set(selectedIds ? [selectedIds] : []);
  }, [selectedIds]);

  const preSelectedIdSet = useMemo(() => new Set(preSelectedIds), [preSelectedIds]);
  const highlightIdSet = useMemo(() => new Set(highlightIds), [highlightIds]);
  const excludedIdSet = useMemo(() => new Set(excludedIds), [excludedIds]);

  // Select all items on load if selectAllOnLoad is true (only on first load)
  useEffect(() => {
    if (selectAllOnLoad && !isLoading && groups.length > 0 && selectionMode === 'multi' && !hasInitializedSelectionRef.current) {
      const allIds = getAllItemIds(groups);
      // Filter out excluded and pre-selected IDs
      const selectableIds = allIds.filter(
        id => !excludedIdSet.has(id) && !preSelectedIdSet.has(id)
      );
      if (selectableIds.length > 0) {
        hasInitializedSelectionRef.current = true;
        onChange(selectableIds);
      }
    }
  }, [selectAllOnLoad, isLoading, groups, selectionMode, excludedIdSet, preSelectedIdSet, onChange]);

  // Filter groups based on search
  const filteredGroups = useMemo(() => {
    return filterGroups(groups, searchQuery, typeFilter);
  }, [groups, searchQuery, typeFilter]);

  // Toggle single item
  const handleToggleItem = useCallback((id: string) => {
    // Excluded items are not selectable
    if (disabled || preSelectedIdSet.has(id) || excludedIdSet.has(id)) return;

    if (selectionMode === 'single') {
      onChange(id);
    } else {
      const newSelection = new Set(selectedIdSet);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      onChange(Array.from(newSelection));
    }
  }, [selectionMode, selectedIdSet, onChange, disabled, preSelectedIdSet, excludedIdSet]);

  // Toggle entire group
  const handleToggleGroup = useCallback((groupId: string, select: boolean) => {
    if (disabled || selectionMode === 'single') return;

    const group = findGroup(filteredGroups, groupId);
    if (!group) return;

    // Recursively collect all item IDs from this group and nested child groups
    function collectGroupItemIds(g: Group): string[] {
      const ids = g.items.map(item => item.id);
      if (g.childGroups) {
        g.childGroups.forEach(cg => {
          ids.push(...collectGroupItemIds(cg));
        });
      }
      return ids;
    }

    const groupItemIds = collectGroupItemIds(group);
    const newSelection = new Set(selectedIdSet);

    groupItemIds.forEach(id => {
      // Skip pre-selected and excluded items
      if (preSelectedIdSet.has(id) || excludedIdSet.has(id)) return;
      if (select) {
        newSelection.add(id);
      } else {
        newSelection.delete(id);
      }
    });

    onChange(Array.from(newSelection));
  }, [filteredGroups, selectedIdSet, onChange, disabled, selectionMode, preSelectedIdSet, excludedIdSet]);

  // Toggle expand/collapse
  const handleToggleExpand = useCallback((groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const loading = externalLoading ?? isLoading;

  const containerClasses = [
    'object-picker',
    className,
    showPreview && previewPosition === 'side' && 'with-preview',
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClasses}>
      <div className="object-picker-main">
        {/* Search and Filter Bar */}
        {showSearch && (
          <ObjectPickerSearch
            value={searchQuery}
            onChange={setSearchQuery}
            typeFilter={typeFilter}
            onTypeFilterChange={setTypeFilter}
            availableTypes={availableTypes}
          />
        )}

        {/* Groups List */}
        <div
          className="object-picker-list"
          style={{ maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }}
          role="listbox"
          aria-multiselectable={selectionMode === 'multi'}
        >
          {loading && <div className="object-picker-loading">Loading...</div>}
          {error && <div className="object-picker-error">{error}</div>}
          {!loading && !error && filteredGroups.length === 0 && (
            <div className="object-picker-empty">{emptyMessage}</div>
          )}
          {!loading && filteredGroups.map(group => (
            <ObjectPickerGroup
              key={group.id}
              group={group}
              selectionMode={selectionMode}
              selectedIds={selectedIdSet}
              expandedGroups={expandedGroups}
              onToggleItem={handleToggleItem}
              onToggleGroup={handleToggleGroup}
              onToggleExpand={handleToggleExpand}
              preSelectedIds={preSelectedIdSet}
              highlightIds={highlightIdSet}
              excludedIds={excludedIdSet}
              disabled={disabled}
            />
          ))}
        </div>
      </div>

      {/* Preview Panel (side mode) */}
      {showPreview && previewPosition === 'side' && (
        <ObjectPickerPreview
          item={previewItem}
          position="side"
          language={language}
          projectId={projectId}
        />
      )}

      {/* Preview Modal */}
      {showPreview && previewPosition === 'modal' && previewItem && (
        <ObjectPickerPreview
          item={previewItem}
          position="modal"
          onClose={() => setPreviewItem(null)}
          language={language}
          projectId={projectId}
        />
      )}
    </div>
  );
};

export default ObjectPicker;

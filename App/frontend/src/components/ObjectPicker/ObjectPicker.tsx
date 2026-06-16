/**
 * Unified ObjectPicker Component
 *
 * A reusable component for selecting objects across different modals.
 * Supports three modes:
 * - story-entities: Characters, Locations, Organizations, Lorebook
 * - manuscript: Acts and Chapters (manuscripts)
 * - all: All context objects (excludes project meta)
 * - translation: Full object list for translation (includes basic_info, guidelines)
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnyObjectType, ObjectType } from '../../types/unifiedObject';
import ObjectPickerSearch from './ObjectPickerSearch';
import ObjectPickerGroup from './ObjectPickerGroup';
import ObjectPickerPreview from './ObjectPickerPreview';
import { useObjectPickerData } from './useObjectPickerData';
import { useTokenCount } from '../../hooks/useTokenCount';
import { useResolvedTaskConfig } from '../../data/settings';
import type { ObjectPickerProps, ObjectPickerItem as PickerItem, ObjectPickerGroup as Group, SelectionState } from './types';
import './ObjectPicker.css';

const EMPTY_OBJECT_TYPES: ObjectType[] = [];
const EMPTY_STRING_ARRAY: string[] = [];

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
    ids.push(...group.items.filter(item => !item.isStructural).map(item => item.id));
    if (group.childGroups) {
      group.childGroups.forEach(childGroup => collectIds(childGroup));
    }
  }

  groups.forEach(group => collectIds(group));
  return ids;
}

/**
 * Get all items from groups (including deeply nested child groups)
 */
function getAllItems(groups: Group[]): PickerItem[] {
  const items: PickerItem[] = [];

  function collectItems(group: Group) {
    items.push(...group.items);
    if (group.childGroups) {
      group.childGroups.forEach(childGroup => collectItems(childGroup));
    }
  }

  groups.forEach(group => collectItems(group));
  return items;
}

function isSubset<T>(subset: Set<T>, superset: Set<T>): boolean {
  for (const value of subset) {
    if (!superset.has(value)) return false;
  }
  return true;
}

function isSameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  return isSubset(a, b);
}

function getMetadataString(item: PickerItem, key: string): string | undefined {
  const value = item.metadata?.[key];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getMetadataStringList(item: PickerItem, key: string): string[] {
  const value = item.metadata?.[key];
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? '').trim())
    .filter((entry) => entry.length > 0);
}

function buildTokenTextForItem(item: PickerItem): string {
  const parts: string[] = [];
  const add = (label: string, value: string | undefined) => {
    const text = value?.trim();
    if (text) {
      parts.push(`${label}: ${text}`);
    }
  };

  if (item.type === 'timeline_event') {
    const formattedDate = getMetadataString(item, 'formattedDate');
    const eventDescription = getMetadataString(item, 'description')
      ?? (formattedDate ? undefined : item.description);
    const tags = getMetadataStringList(item, 'tags');

    add('Timeline event', item.name);
    add('Track', getMetadataString(item, 'trackName'));
    add('Date', formattedDate);
    add('Description', eventDescription);
    add('Content', item.content);
    if (tags.length > 0) {
      add('Tags', tags.join(', '));
    }
    return parts.join('\n');
  }

  add('Name', item.name);
  add('Description', item.description);
  add('Content', item.content);
  return parts.join('\n');
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
function isAllowedGroupType(groupType: AnyObjectType, typeFilter: AnyObjectType | null): boolean {
  if (!typeFilter) return true;
  if (groupType === typeFilter) return true;
  return (
    (typeFilter === 'outline' && groupType === 'outline') ||
    (typeFilter === 'manuscript' && (groupType === 'manuscript' || groupType === 'outline')) ||
    (
      (typeFilter === 'timeline_track' || typeFilter === 'timeline_event') &&
      (groupType === 'timeline_track' || groupType === 'timeline_event')
    )
  );
}

function matchesSearchValue(value: string | undefined, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return value?.toLowerCase().includes(normalizedQuery) ?? false;
}

function itemMatchesSearch(item: PickerItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  return (
    matchesSearchValue(item.name, normalizedQuery) ||
    matchesSearchValue(item.description, normalizedQuery) ||
    matchesSearchValue(item.content, normalizedQuery)
  );
}

function filterGroupByType(group: Group, typeFilter: AnyObjectType | null): Group | null {
  if (!isAllowedGroupType(group.type, typeFilter)) {
    return null;
  }

  const filteredItems = group.items.filter((item) => !typeFilter || item.type === typeFilter);
  const filteredChildGroups = group.childGroups
    ?.map((childGroup) => filterGroupByType(childGroup, typeFilter))
    .filter(Boolean) as Group[] | undefined;

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
}

function filterGroupBySearch(group: Group, normalizedQuery: string): Group | null {
  if (!normalizedQuery) {
    return group;
  }

  const groupMatchesSearch =
    matchesSearchValue(group.label, normalizedQuery) ||
    matchesSearchValue(group.description, normalizedQuery);

  if (groupMatchesSearch) {
    return group;
  }

  const filteredItems = group.items.filter((item) => itemMatchesSearch(item, normalizedQuery));
  const filteredChildGroups = group.childGroups
    ?.map((childGroup) => filterGroupBySearch(childGroup, normalizedQuery))
    .filter(Boolean) as Group[] | undefined;

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
}

function filterGroups(
  groups: Group[],
  searchQuery: string,
  typeFilter: AnyObjectType | null
): Group[] {
  if (!searchQuery && !typeFilter) return groups;

  const normalizedQuery = searchQuery.toLowerCase().trim();
  const groupsFilteredByType = groups
    .map((group) => filterGroupByType(group, typeFilter))
    .filter(Boolean) as Group[];

  if (!normalizedQuery) {
    return groupsFilteredByType;
  }

  return groupsFilteredByType
    .map((group) => filterGroupBySearch(group, normalizedQuery))
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
  excludeTypes = EMPTY_OBJECT_TYPES,
  filterIds,
  preSelectedIds = EMPTY_STRING_ARRAY,
  highlightIds = EMPTY_STRING_ARRAY,
  excludedIds = EMPTY_STRING_ARRAY,
  disabled = false,
  loading: externalLoading,
  customGroups,
  onLoadComplete,
  selectAllOnLoad = false,
  maxHeight = '400px',
  className = '',
  emptyMessage,
  showSearch = true,
  showSelectAll = false,
  showTokenCount = false,
}) => {
  const { t } = useTranslation();

  // Get settings for token counting
  const agentConfig = useResolvedTaskConfig('agent');
  // Internal state
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<AnyObjectType | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [previewItem, setPreviewItem] = useState<PickerItem | null>(null);
  const hasInitializedSelectionRef = useRef(false);
  const prevSelectableIdSetRef = useRef<Set<string> | null>(null);
  const prevSelectedIdSetRef = useRef<Set<string> | null>(null);

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
  const internalLoading = customGroups ? false : fetchLoading;
  const loading = externalLoading ?? internalLoading;

  // Apply filterIds filtering if provided
  const groups = useMemo(() => {
    if (!filterIds || filterIds.length === 0) return baseGroups;
    return filterGroupsByIds(baseGroups, new Set(filterIds));
  }, [baseGroups, filterIds]);

  // Notify when loading completes
  useEffect(() => {
    if (!loading && onLoadComplete) {
      onLoadComplete();
    }
  }, [loading, onLoadComplete]);

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

  // Calculate global selection state for select all toggle
  const globalSelectionState = useMemo((): SelectionState => {
    const allIds = getAllItemIds(groups).filter(
      id => !excludedIdSet.has(id) && !preSelectedIdSet.has(id)
    );
    if (allIds.length === 0) return 'unchecked';
    const selectedCount = allIds.filter(id => selectedIdSet.has(id)).length;
    if (selectedCount === 0) return 'unchecked';
    if (selectedCount === allIds.length) return 'checked';
    return 'indeterminate';
  }, [groups, selectedIdSet, excludedIdSet, preSelectedIdSet]);

  // Calculate combined content from selected items for token counting.
  // In "all" mode, include content from structural ancestor items (closure parents).
  const selectedItemsContent = useMemo(() => {
    if (!showTokenCount) return '';
    const allItems = getAllItems(groups);
    let relevantIds = selectedIdSet;

    if (mode === 'all' || mode === 'manuscript') {
      // Build closure: add parent IDs for selected items
      const itemsById = new Map(allItems.map(item => [item.id, item]));
      const closureIds = new Set(selectedIdSet);
      for (const id of selectedIdSet) {
        let parentId = itemsById.get(id)?.parentId;
        while (parentId) {
          closureIds.add(parentId);
          parentId = itemsById.get(parentId)?.parentId;
        }
      }
      relevantIds = closureIds;
    }

    const relevantItems = allItems.filter(item => relevantIds.has(item.id));
    return relevantItems
      .map(buildTokenTextForItem)
      .filter(content => content.length > 0)
      .join('\n\n');
  }, [groups, selectedIdSet, showTokenCount, mode]);

  // Token counting for selected items
  const {
    tokenCount,
    isLoading: isCountingTokens,
    isEstimate: isTokenCountEstimate,
  } = useTokenCount({
    text: selectedItemsContent,
    provider: agentConfig?.provider || 'openrouter',
    model: agentConfig?.model || '',
    tokenizer_override: agentConfig?.advanced?.tokenizer_override ?? undefined,
    variant_hint: agentConfig?.advanced?.custom_kind ?? undefined,
    enabled: showTokenCount && selectedItemsContent.length > 0,
  });

  // Handle select/deselect all toggle
  const handleSelectAllToggle = useCallback(() => {
    if (disabled || selectionMode !== 'multi') return;
    const allIds = getAllItemIds(groups).filter(
      id => !excludedIdSet.has(id) && !preSelectedIdSet.has(id)
    );
    if (globalSelectionState === 'checked') {
      onChange([]);  // Deselect all
    } else {
      onChange(allIds);  // Select all
    }
  }, [groups, globalSelectionState, onChange, disabled, selectionMode, excludedIdSet, preSelectedIdSet]);

  // Select all items on load if selectAllOnLoad is true (only on first load)
  useEffect(() => {
    if (selectAllOnLoad && !loading && groups.length > 0 && selectionMode === 'multi' && !hasInitializedSelectionRef.current) {
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
  }, [selectAllOnLoad, loading, groups, selectionMode, excludedIdSet, preSelectedIdSet, onChange]);

  // Keep "Select All" sticky: when everything was selected and new items are added, auto-select the new items.
  useEffect(() => {
    const selectableIds = getAllItemIds(groups).filter(
      id => !excludedIdSet.has(id) && !preSelectedIdSet.has(id)
    );
    const selectableIdSet = new Set(selectableIds);

    const prevSelectableIdSet = prevSelectableIdSetRef.current;
    const prevSelectedIdSet = prevSelectedIdSetRef.current;

    if (
      !disabled &&
      selectionMode === 'multi' &&
      prevSelectableIdSet &&
      prevSelectedIdSet &&
      prevSelectableIdSet.size > 0 &&
      isSubset(prevSelectableIdSet, prevSelectedIdSet) &&
      isSameSet(prevSelectedIdSet, selectedIdSet)
    ) {
      const addedIds: string[] = [];
      for (const id of selectableIdSet) {
        if (!prevSelectableIdSet.has(id)) {
          addedIds.push(id);
        }
      }

      if (addedIds.length > 0) {
        const nextSelection = new Set(selectedIdSet);
        addedIds.forEach(id => nextSelection.add(id));
        onChange(Array.from(nextSelection));
      }
    }

    prevSelectableIdSetRef.current = selectableIdSet;
    prevSelectedIdSetRef.current = new Set(selectedIdSet);
  }, [groups, excludedIdSet, preSelectedIdSet, selectedIdSet, disabled, selectionMode, onChange]);

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

    // Recursively collect all selectable item IDs from this group and nested child groups
    function collectGroupItemIds(g: Group): string[] {
      const ids = g.items.filter(item => !item.isStructural).map(item => item.id);
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

        {/* Select All Header */}
        {(showSelectAll || showTokenCount) && selectionMode === 'multi' && (
          <div className="object-picker-header">
            {/* Token Count (left side) */}
            {showTokenCount && (
              <div className="object-picker-token-count">
                {isCountingTokens ? (
                  <span className="object-picker-token-spinner" />
                ) : tokenCount !== null && tokenCount > 0 ? (
                  <>
                    <span>{t('objectPicker.tokenCount', { count: tokenCount })}</span>
                    {isTokenCountEstimate && (
                      <span
                        className="object-picker-token-estimate"
                        title={t('objectPicker.tokenEstimateHint')}
                      >
                        ~
                      </span>
                    )}
                  </>
                ) : (
                  <span className="object-picker-token-empty">
                    {t('objectPicker.noTokens')}
                  </span>
                )}
              </div>
            )}

            {/* Select All (right side) */}
            {showSelectAll && (
              <label className="object-picker-select-all-label">
                <input
                  type="checkbox"
                  checked={globalSelectionState === 'checked'}
                  ref={(el) => { if (el) el.indeterminate = globalSelectionState === 'indeterminate'; }}
                  onChange={handleSelectAllToggle}
                  disabled={disabled}
                />
                <span>{t('objectPicker.selectAll')}</span>
              </label>
            )}
          </div>
        )}

        {/* Groups List */}
        <div
          className="object-picker-list"
          style={{ maxHeight: typeof maxHeight === 'number' ? `${maxHeight}px` : maxHeight }}
          role="listbox"
          aria-multiselectable={selectionMode === 'multi'}
        >
          {loading && <div className="object-picker-loading">{t('objectPicker.loading')}</div>}
          {error && <div className="object-picker-error">{error}</div>}
          {!loading && !error && filteredGroups.length === 0 && (
            <div className="object-picker-empty">{emptyMessage || t('objectPicker.noObjectsAvailable')}</div>
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

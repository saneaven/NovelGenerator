import type { ObjectPickerGroup, ObjectPickerItem, ObjectPickerMode } from './types';

function getAllItems(groups: ObjectPickerGroup[]): ObjectPickerItem[] {
  const items: ObjectPickerItem[] = [];

  function collectItems(group: ObjectPickerGroup) {
    items.push(...group.items);
    if (group.childGroups) {
      group.childGroups.forEach(childGroup => collectItems(childGroup));
    }
  }

  groups.forEach(group => collectItems(group));
  return items;
}

export function getObjectPickerTokenObjectIds(
  groups: ObjectPickerGroup[],
  selectedIds: ReadonlySet<string>,
  mode: ObjectPickerMode
): string[] {
  const allItems = getAllItems(groups);
  let relevantIds = selectedIds;

  if (mode === 'all' || mode === 'manuscript') {
    const itemsById = new Map(allItems.map(item => [item.id, item]));
    const closureIds = new Set(selectedIds);
    for (const id of selectedIds) {
      let parentId = itemsById.get(id)?.parentId;
      while (parentId) {
        closureIds.add(parentId);
        parentId = itemsById.get(parentId)?.parentId;
      }
    }
    relevantIds = closureIds;
  }

  return allItems
    .filter(item => relevantIds.has(item.id) && !item.isStructural)
    .map(item => item.id);
}

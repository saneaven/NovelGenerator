import type { ObjectPickerGroup, ObjectPickerItem } from '../../../components/ObjectPicker/types';

export const LINKABLE_TYPES = new Set<string>(['story_entity', 'outline']);

export function filterLinkGroups(groups: ObjectPickerGroup[]): ObjectPickerGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => LINKABLE_TYPES.has(item.type)),
      childGroups: group.childGroups ? filterLinkGroups(group.childGroups) : undefined,
    }))
    .filter((group) => group.items.length > 0 || (group.childGroups?.length ?? 0) > 0);
}

export function collectLinkItems(groups: ObjectPickerGroup[]): Map<string, ObjectPickerItem> {
  const items = new Map<string, ObjectPickerItem>();
  const walk = (list: ObjectPickerGroup[]) => {
    for (const group of list) {
      for (const item of group.items) items.set(item.id, item);
      if (group.childGroups) walk(group.childGroups);
    }
  };
  walk(groups);
  return items;
}

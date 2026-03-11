import type { ObjectType, StoryObjectSubtype } from '../ui/vmTypes';

export function parseStorySubtype(raw: unknown): StoryObjectSubtype | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'character' || raw === 'location' || raw === 'organization' || raw === 'lorebook') {
    return raw;
  }
  return undefined;
}

export function objectTypeLabel(objectType: ObjectType, storySubtype?: StoryObjectSubtype): string {
  switch (objectType) {
    case 'story_object':
      return storySubtype
        ? storySubtype.replace(/(^\w)/, (char) => char.toUpperCase())
        : 'Story Object';
    case 'basic_info':
      return 'Basic Info';
    case 'guidelines':
      return 'Guidelines';
    case 'outline':
      return 'Outline';
    case 'outline_act':
      return 'Act';
    case 'outline_chapter':
      return 'Chapter';
    case 'manuscript':
      return 'Manuscript';
    default:
      return 'Object';
  }
}

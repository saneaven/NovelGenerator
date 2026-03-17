import type { ObjectType, StoryEntityKind } from '../ui/vmTypes';

export function parseStoryEntityKind(raw: unknown): StoryEntityKind | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'character' || raw === 'location' || raw === 'organization' || raw === 'lorebook') {
    return raw;
  }
  return undefined;
}

export function objectTypeLabel(objectType: ObjectType, storyEntityKind?: StoryEntityKind): string {
  switch (objectType) {
    case 'story_entity':
      return storyEntityKind
        ? `${storyEntityKind.replace(/(^\w)/, (char) => char.toUpperCase())} Entity`
        : 'Story Entity';
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

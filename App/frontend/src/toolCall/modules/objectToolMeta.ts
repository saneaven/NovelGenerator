import type { ObjectType, OutlineKind, StoryEntityKind } from '../ui/vmTypes';

export function parseStoryEntityKind(raw: unknown): StoryEntityKind | undefined {
  if (typeof raw !== 'string') return undefined;
  if (raw === 'character' || raw === 'location' || raw === 'organization' || raw === 'lorebook') {
    return raw;
  }
  return undefined;
}

export function parseOutlineKind(raw: unknown): OutlineKind | undefined {
  if (raw === 'outline' || raw === 'act' || raw === 'chapter') {
    return raw;
  }
  return undefined;
}

export function objectTypeLabel(objectType: ObjectType, storyEntityKind?: StoryEntityKind, outlineKind?: OutlineKind): string {
  switch (objectType) {
    case 'story_entity_folder':
      return 'Story Entity Folder';
    case 'story_entity':
      return storyEntityKind
        ? `${storyEntityKind.replace(/(^\w)/, (char) => char.toUpperCase())} Entity`
        : 'Story Entity';
    case 'basic_info':
      return 'Basic Info';
    case 'guidelines':
      return 'Guidelines';
    case 'outline':
      if (outlineKind === 'act') return 'Act';
      if (outlineKind === 'chapter') return 'Chapter';
      return 'Outline';
    case 'manuscript':
      return 'Manuscript';
    case 'timeline_track':
      return 'Timeline Track';
    case 'timeline_event':
      return 'Timeline Event';
    default:
      return 'Object';
  }
}

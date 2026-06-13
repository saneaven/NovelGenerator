import type { ObjectType } from './unifiedObject';

export const OBJECT_TYPE_CONFIG: Record<ObjectType, { label: string; order: number }> = {
  basic_info: { label: 'Basic Info', order: 0 },
  guidelines: { label: 'Guidelines', order: 0.5 },
  story_entity_folder: { label: 'Story Entity Folders', order: 0.75 },
  story_entity: { label: 'Story Entities', order: 1 },
  timeline_track: { label: 'Timeline Track', order: 2.1 },
  timeline_event: { label: 'Timeline Event', order: 2.2 },
  outline: { label: 'Outline', order: 5 },
  manuscript: { label: 'Manuscripts', order: 6 },
};

import type { ObjectType } from './unifiedObject';

// UI Tab types for story object panels
export type StoryObjectTabType = 'basicInfo' | 'guidelines' | 'storyEntities' | 'outline';

export const OBJECT_TYPE_CONFIG: Record<ObjectType, { label: string; order: number }> = {
  basic_info: { label: 'Basic Info', order: 0 },
  guidelines: { label: 'Guidelines', order: 0.5 },
  story_entity: { label: 'Story Entities', order: 1 },
  outline: { label: 'Outline', order: 5 },
  act: { label: 'Acts', order: 6 },
  chapter: { label: 'Chapters', order: 7 },
  manuscript: { label: 'Manuscripts', order: 8 },
};

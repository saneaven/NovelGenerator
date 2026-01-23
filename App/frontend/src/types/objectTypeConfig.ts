import type { ObjectType } from './unifiedObject';

// UI Tab types for story object panels
export type StoryObjectTabType = 'basicInfo' | 'guidelines' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline';

export const OBJECT_TYPE_CONFIG: Record<ObjectType, { label: string; order: number }> = {
  basic_info: { label: 'Basic Info', order: 0 },
  guidelines: { label: 'Guidelines', order: 9 },
  character: { label: 'Characters', order: 1 },
  organization: { label: 'Organizations', order: 2 },
  location: { label: 'Locations', order: 3 },
  lorebook: { label: 'Lorebook', order: 4 },
  outline: { label: 'Outline', order: 5 },
  act: { label: 'Acts', order: 6 },
  chapter: { label: 'Chapters', order: 7 },
  manuscript: { label: 'Manuscripts', order: 8 },
};


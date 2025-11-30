import type { LanguageData } from './multilingual';
export type { LanguageData } from './multilingual';
import { generateTempId } from '../utils/tempId';

// Version history for story objects with language support
export interface ObjectVersion<T = any> {
  versionId: string;
  timestamp: Date;
  userRequest: string;
  data: LanguageData<T>; // Each version stores data for multiple languages
  isActive: boolean;
}

// Base metadata for all story objects
export interface BaseMetadata {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  versions: ObjectVersion[];
  activeVersionId: string;
}

// Basic Info Types
export interface BasicInfo extends BaseMetadata {
  title: string;
  logline: string;
  genre: string;
}

// Name-Description pair for various objects
export interface NameDescriptionItem extends BaseMetadata {
  name: string;
  description: string;
}

// Character, Organization, Location, Lorebook types
export type Character = NameDescriptionItem;
export type Organization = NameDescriptionItem;
export type Location = NameDescriptionItem;
export type LorebookEntry = NameDescriptionItem;

// Outline Types
export interface Chapter extends BaseMetadata {
  name: string;
  description: string;
  actId: string; // Reference to parent Act
}

export interface Act extends BaseMetadata {
  name: string;
  description: string;
  chapters: Chapter[];
}

export interface Outline extends BaseMetadata {
  acts: Act[];
}

// Story Object Categories
export type StoryObjectCategory = 
  | 'basicInfo'
  | 'character'
  | 'organization'
  | 'location'
  | 'lorebook'
  | 'outline'
  | 'act'
  | 'chapter';

// Combined Story Objects type
export interface StoryObjects {
  basicInfo: BasicInfo | null;
  characters: Character[];
  organizations: Organization[];
  locations: Location[];
  lorebook: LorebookEntry[];
  outline: Outline | null;
}

// Helper type for category-specific operations
export type StoryObjectByCategory = {
  basicInfo: BasicInfo;
  character: Character;
  organization: Organization;
  location: Location;
  lorebook: LorebookEntry;
  outline: Outline;
};

// Utility function to create base metadata
export const createBaseMetadata = (): BaseMetadata => {
  const id = generateTempId();
  const now = new Date();
  const initialVersionId = generateTempId();
  
  return {
    id,
    createdAt: now,
    updatedAt: now,
    versions: [{
      versionId: initialVersionId,
      timestamp: now,
      userRequest: 'Initial creation',
      data: {}, // Will be set when actual data is available
      isActive: true,
    }],
    activeVersionId: initialVersionId,
  };
};

// Utility function to ensure object has version fields
export const ensureVersionFields = <T extends BaseMetadata>(obj: T): T => {
  if (!obj.versions || !obj.activeVersionId) {
    const now = new Date();
    const initialVersionId = generateTempId();
    
    return {
      ...obj,
      versions: obj.versions || [{
        versionId: initialVersionId,
        timestamp: now,
        userRequest: 'Legacy data migration',
        data: obj,
        isActive: true,
      }],
      activeVersionId: obj.activeVersionId || initialVersionId,
    };
  }
  return obj;
};

// Utility function to create name-description item
export const createNameDescriptionItem = (
  name: string = '',
  description: string = '',
  primaryLanguage: string = 'English'
): NameDescriptionItem => {
  const baseMetadata = createBaseMetadata();
  const item = {
    ...baseMetadata,
    name,
    description,
  };

  // Set the initial version data with user's primary language
  item.versions[0].data = {
    [primaryLanguage]: {
      name,
      description,
    },
  };

  return item;
};

// Utility function to create empty story objects
export const createEmptyStoryObjects = (): StoryObjects => ({
  basicInfo: null,
  characters: [],
  organizations: [],
  locations: [],
  lorebook: [],
  outline: null,
});

// Utility function to create empty basic info
export const createEmptyBasicInfo = (primaryLanguage: string = 'English'): BasicInfo => {
  const baseMetadata = createBaseMetadata();
  const basicInfo = {
    ...baseMetadata,
    title: '',
    logline: '',
    genre: '',
  };

  // Set the initial version data with user's primary language
  basicInfo.versions[0].data = {
    [primaryLanguage]: {
      title: '',
      logline: '',
      genre: '',
    },
  };

  return basicInfo;
};

// Utility function to create empty chapter
export const createEmptyChapter = (actId: string, primaryLanguage: string = 'English'): Chapter => {
  const baseMetadata = createBaseMetadata();
  const chapter = {
    ...baseMetadata,
    name: '',
    description: '',
    actId,
  };

  // Set the initial version data with user's primary language
  chapter.versions[0].data = {
    [primaryLanguage]: {
      name: '',
      description: '',
    },
  };

  return chapter;
};

// Utility function to create empty act
export const createEmptyAct = (primaryLanguage: string = 'English'): Act => {
  const baseMetadata = createBaseMetadata();
  const act = {
    ...baseMetadata,
    name: '',
    description: '',
    chapters: [],
  };

  // Set the initial version data with user's primary language
  act.versions[0].data = {
    [primaryLanguage]: {
      name: '',
      description: '',
    },
  };

  return act;
};

// Utility function to create empty outline
export const createEmptyOutline = (primaryLanguage: string = 'English'): Outline => {
  const baseMetadata = createBaseMetadata();
  const outline = {
    ...baseMetadata,
    acts: [],
  };

  // Set the initial version data with user's primary language
  outline.versions[0].data = {
    [primaryLanguage]: {
      acts: [],
    },
  };

  return outline;
};

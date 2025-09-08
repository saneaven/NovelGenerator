// Version history for story objects
export interface ObjectVersion<T = any> {
  versionId: string;
  timestamp: Date;
  userRequest: string;
  data: T;
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
  | 'outline';

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
  const id = crypto.randomUUID();
  const now = new Date();
  const initialVersionId = crypto.randomUUID();
  
  return {
    id,
    createdAt: now,
    updatedAt: now,
    versions: [{
      versionId: initialVersionId,
      timestamp: now,
      userRequest: 'Initial creation',
      data: null, // Will be set when actual data is available
      isActive: true,
    }],
    activeVersionId: initialVersionId,
  };
};

// Utility function to ensure object has version fields
export const ensureVersionFields = <T extends BaseMetadata>(obj: T): T => {
  if (!obj.versions || !obj.activeVersionId) {
    const now = new Date();
    const initialVersionId = crypto.randomUUID();
    
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
  description: string = ''
): NameDescriptionItem => ({
  ...createBaseMetadata(),
  name,
  description,
});

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
export const createEmptyBasicInfo = (): BasicInfo => ({
  ...createBaseMetadata(),
  title: '',
  logline: '',
  genre: '',
});

// Utility function to create empty chapter
export const createEmptyChapter = (actId: string): Chapter => ({
  ...createBaseMetadata(),
  name: '',
  description: '',
  actId,
});

// Utility function to create empty act
export const createEmptyAct = (): Act => ({
  ...createBaseMetadata(),
  name: '',
  description: '',
  chapters: [],
});

// Utility function to create empty outline
export const createEmptyOutline = (): Outline => ({
  ...createBaseMetadata(),
  acts: [],
});
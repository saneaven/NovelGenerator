import type {
  StoryEntityFolderData as UnifiedStoryEntityFolderData,
  StoryEntityFolderObject,
  StoryEntityKind,
  StoryEntityTreeResponse,
  UnifiedObject,
} from './unifiedObject';

export type StoryEntityFolderData = UnifiedStoryEntityFolderData;
export type StoryEntityFolder = StoryEntityFolderObject;
export type StoryEntityTreePayload = StoryEntityTreeResponse;

export interface StoryEntityTreeNode {
  id: string;
  folder: StoryEntityFolder | null;
  parentId: string | null;
  folders: StoryEntityTreeNode[];
  entities: UnifiedObject[];
}

export interface StoryEntityKindOption {
  kind: StoryEntityKind;
  label: string;
}

export function getStoryEntityFolderData(
  folder: StoryEntityFolder,
  _preferredLanguage?: string | null,
  _fallbackLanguage?: string | null,
): StoryEntityFolderData {
  const data = folder.data ?? {};
  return {
    name: typeof data.name === 'string' ? data.name : '',
    description: typeof data.description === 'string' ? data.description : '',
  };
}

export function getStoryEntityFolderName(
  folder: StoryEntityFolder,
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): string {
  return getStoryEntityFolderData(folder, preferredLanguage, fallbackLanguage).name || '';
}

export function getStoryEntityFolderDescription(
  folder: StoryEntityFolder,
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): string {
  return getStoryEntityFolderData(folder, preferredLanguage, fallbackLanguage).description || '';
}

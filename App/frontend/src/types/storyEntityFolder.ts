import type { StoryEntityKind, UnifiedObject } from './unifiedObject';

export interface StoryEntityFolderData {
  name: string;
  description: string;
}

export interface StoryEntityFolderVersionInfo {
  id: string | null;
  number: number;
  created_at: string | null;
}

export interface StoryEntityFolder {
  id: string;
  project_id: string;
  name: string;
  description: string;
  parent_id: string | null;
  display_order: number;
  created_at: string | null;
  updated_at: string | null;
  data: Record<string, StoryEntityFolderData>;
  version: StoryEntityFolderVersionInfo;
}

export interface StoryEntityFolderListResponse {
  folders: StoryEntityFolder[];
}

export interface StoryEntityFolderDeleteResponse {
  success: boolean;
  deleted_folder_ids: string[];
  deleted_entity_ids: string[];
}

export interface StoryEntityTreeMoveRequest {
  node_kind: 'folder' | 'entity';
  node_id: string;
  new_parent_folder_id?: string | null;
  new_index?: number;
}

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
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): StoryEntityFolderData {
  const data = folder.data ?? {};
  if (preferredLanguage && data[preferredLanguage]) {
    return data[preferredLanguage];
  }
  if (fallbackLanguage && data[fallbackLanguage]) {
    return data[fallbackLanguage];
  }
  const firstLanguage = Object.keys(data)[0];
  if (firstLanguage && data[firstLanguage]) {
    return data[firstLanguage];
  }
  return {
    name: folder.name || '',
    description: folder.description || '',
  };
}

export function getStoryEntityFolderName(
  folder: StoryEntityFolder,
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): string {
  return getStoryEntityFolderData(folder, preferredLanguage, fallbackLanguage).name || folder.name || '';
}

export function getStoryEntityFolderDescription(
  folder: StoryEntityFolder,
  preferredLanguage?: string | null,
  fallbackLanguage?: string | null,
): string {
  return getStoryEntityFolderData(folder, preferredLanguage, fallbackLanguage).description || folder.description || '';
}

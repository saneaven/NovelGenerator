import type { StoryEntityKind, UnifiedObject } from './unifiedObject';

export interface StoryEntityFolder {
  id: string;
  project_id: string;
  name: string;
  parent_id: string | null;
  display_order: number;
  created_at: string | null;
  updated_at: string | null;
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

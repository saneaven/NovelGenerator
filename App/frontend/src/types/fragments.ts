/**
 * Types for prompt fragment management
 */

/**
 * Fragment content response from API
 */
export interface FragmentContent {
  id: string;
  folder_id: string | null;
  folder_path: string | null;
  fragment_name: string;
  content: string;
  description: string | null;
  version_number: number;
  is_system_default: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Fragment version response from API
 */
export interface FragmentVersion {
  id: string;
  folder_id: string | null;
  folder_path: string | null;
  fragment_name: string;
  content: string;
  description: string | null;
  version_number: number;
  is_system_default: boolean;
  created_at: string;
  updated_at: string;
  note: string | null;
}

/**
 * Fragment version history item
 */
export interface FragmentVersionHistoryItem {
  version_number: number;
  created_at: string;
  note: string | null;
  is_system_default: boolean;
  preview: string;
}

/**
 * Fragment list item for tree/list views
 */
export interface FragmentListItem {
  id: string;
  folder_id: string | null;
  folder_path: string | null;
  fragment_name: string;
  description: string | null;
  is_system_default: boolean;
  version_number: number;
  updated_at: string;
}

/**
 * Fragment with content for template engine
 */
export interface FragmentWithContent {
  id: string;
  folder_id: string | null;
  folder_path: string | null;
  fragment_name: string;
  content: string;
  description: string | null;
  is_system_default: boolean;
}

/**
 * Folder tree node for hierarchical display
 */
export interface FolderTreeNode {
  id: string;
  name: string;
  path: string;
  parent_id: string | null;
  fragments: FragmentListItem[];
  children: FolderTreeNode[];
}

/**
 * Fragment tree response from API
 */
export interface FragmentTreeResponse {
  root_fragments: FragmentListItem[];
  folders: FolderTreeNode[];
}

/**
 * Fragment validation response
 */
export interface FragmentValidationResponse {
  is_valid: boolean;
  syntax_errors: string[];
  warnings: string[];
  referenced_fragments: string[];
}

/**
 * Folder response from API
 */
export interface FolderResponse {
  id: string;
  name: string;
  path: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Get the full path for a fragment (uses computed folder_path)
 */
export function getFragmentPath(fragment: FragmentListItem | FragmentContent): string {
  return fragment.folder_path
    ? `${fragment.folder_path}/${fragment.fragment_name}`
    : fragment.fragment_name;
}

/**
 * Parse a full path into folder_path and fragment_name
 */
export function parseFragmentPath(fullPath: string): { folderPath: string | null; fragmentName: string } {
  const lastSlash = fullPath.lastIndexOf('/');
  if (lastSlash === -1) {
    return { folderPath: null, fragmentName: fullPath };
  }
  return {
    folderPath: fullPath.substring(0, lastSlash),
    fragmentName: fullPath.substring(lastSlash + 1),
  };
}

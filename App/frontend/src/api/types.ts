/**
 * TypeScript types for API requests and responses
 */

import type { TipTapDoc } from '../types/tiptap';

// ============================================================================
// BASE TYPES
// ============================================================================

export interface BaseMetadata {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface LanguageData<T = any> {
  [language: string]: T;
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

export interface UserCreate {
  email: string;
  username: string;
  password: string;
}

export interface UserLogin {
  username: string;
  password: string;
}

export interface UserResponse extends BaseMetadata {
  email: string;
  username: string;
  is_active: boolean;
  is_verified: boolean;
  last_login_at?: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user?: UserResponse; // Optional - may be fetched separately
}

export interface ProfileUpdate {
  username?: string;
  email?: string;
}

export interface PasswordChange {
  current_password: string;
  new_password: string;
}

// ============================================================================
// PROJECTS
// ============================================================================

export interface ProjectCreate {
  name: string;
  description?: string;
  main_language: string;
}

export interface ProjectUpdate {
  name?: string;
  description?: string;
}

export interface ProjectResponse extends BaseMetadata {
  user_id: string;
  name: string;
  description?: string;
}

// ============================================================================
// BASIC INFO
// ============================================================================

export interface BasicInfoCreate {
  title: string;
  logline: string;
  genre: string;
  language?: string;
}

export interface BasicInfoUpdate {
  title?: string;
  logline?: string;
  genre?: string;
  language?: string;
}

export interface BasicInfoResponse extends BaseMetadata {
  project_id: string;
  title?: string;
  logline?: string;
  genre?: string;
}

// ============================================================================
// NAME/DESCRIPTION OBJECTS (Characters, Organizations, Locations, Lorebook)
// ============================================================================

export interface NameDescriptionCreate {
  name: string;
  description?: string;  // One-line summary for object indexes
  content: string;  // Full content
  language?: string;
}

export interface NameDescriptionUpdate {
  name?: string;
  description?: string;  // One-line summary for object indexes
  content?: string;  // Full content
  language?: string;
}

export interface NameDescriptionResponse extends BaseMetadata {
  project_id: string;
  name?: string;
  description?: string;  // One-line summary for object indexes
  content?: string;  // Full content
}

// ============================================================================
// OUTLINE, ACTS, CHAPTERS
// ============================================================================

export interface OutlineResponse extends BaseMetadata {
  project_id: string;
  acts: ActResponse[];
}

export interface ActCreate {
  name: string;
  description?: string;  // One-line summary for object indexes
  content: string;  // Full content
  order: number;
  language?: string;
}

export interface ActUpdate {
  name?: string;
  description?: string;  // One-line summary for object indexes
  content?: string;  // Full content
  order?: number;
  language?: string;
}

export interface ActResponse extends BaseMetadata {
  outline_id: string;
  name?: string;
  description?: string;  // One-line summary for object indexes
  content?: string;  // Full content
  order: number;
  chapters: ChapterResponse[];
}

export interface ChapterCreate {
  name: string;
  description?: string;  // One-line summary for object indexes
  content: string;  // Full content
  order: number;
  language?: string;
}

export interface ChapterUpdate {
  name?: string;
  description?: string;  // One-line summary for object indexes
  content?: string;  // Full content
  order?: number;
  language?: string;
}

export interface ChapterResponse extends BaseMetadata {
  act_id: string;
  name?: string;
  description?: string;  // One-line summary for object indexes
  content?: string;  // Full content
  order: number;
}

// ============================================================================
// MANUSCRIPT (Chapter Content)
// ============================================================================

export interface ManuscriptCreate {
  doc: TipTapDoc;
  language?: string;
  userRequest?: string;
}

export interface ManuscriptUpdate {
  doc: TipTapDoc;
  language?: string;
  userRequest?: string;
  create_new_version?: boolean;  // If false, updates existing active version instead of creating new one
}

export interface ManuscriptVersionResponse {
  id: string;
  manuscript_id: string;
  userRequest: string;
  is_active: boolean;  // Use snake_case to match backend
  data: LanguageData<{ doc: TipTapDoc; wordCount: number }>;
  timestamp: string;
}

export interface ManuscriptResponse {
  id: string;
  chapter_id: string;
  created_at: string;
  updated_at: string;
  versions: ManuscriptVersionResponse[];
}

// ============================================================================
// VERSION HISTORY
// ============================================================================

export interface VersionResponse {
  id: string;
  object_id: string;
  object_type: string;
  user_request?: string;
  is_active: boolean;
  data: LanguageData;
  timestamp: string;
}

export interface VersionListResponse {
  versions: VersionResponse[];
  total: number;
}

// ============================================================================
// AGENTS
// ============================================================================

export interface AgentCreate {
  name: string;
}

export interface AgentUpdate {
  name?: string;
}

export interface AgentResponse extends BaseMetadata {
  project_id: string;
  name: string;
  messages: AgentMessageResponse[];
}

export interface ContentPart {
  type: 'content' | 'thinking';
  text: string;
}

export interface AgentMessageCreate {
  role: string;
  content_parts?: ContentPart[];
  language?: string;
  function_calls?: any;
  thinking_details?: any[];
}

export interface AgentMessageUpdate {
  content_parts?: ContentPart[];
  language?: string;
  function_calls?: any;
  thinking_details?: any[];
}

export interface AgentMessageResponse {
  id: string;
  agent_id: string;
  role: string;
  data: LanguageData<{
    contentParts: ContentPart[];
    thinking_details?: any[];
  }>;
  function_calls?: any;
  created_at: string;
}

// ============================================================================
// USER SETTINGS
// ============================================================================

export interface UserSettings {
  id: string;
  user_id: string;
  active_provider: string;
  ai_model: string;
  providers_config: Record<string, any>;
  provider_preferences: Record<string, any>;
  primary_language: string;
  secondary_language?: string;
  created_at: string;
  updated_at: string;
}

export interface UserSettingsUpdate {
  active_provider?: string;
  ai_model?: string;
  providers_config?: Record<string, any>;
  provider_preferences?: Record<string, any>;
  primary_language?: string;
  secondary_language?: string;
}

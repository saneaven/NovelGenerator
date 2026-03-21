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
  is_admin: boolean;
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
  genres: string[];
  tags: string[];
  language?: string;
}

export interface BasicInfoUpdate {
  title?: string;
  logline?: string;
  genres?: string[];
  tags?: string[];
  language?: string;
}

export interface BasicInfoResponse extends BaseMetadata {
  project_id: string;
  title?: string;
  logline?: string;
  genres: string[];
  tags: string[];
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
// OUTLINE
// ============================================================================

export type OutlineKind = 'outline' | 'act' | 'chapter';

export interface OutlineCreate {
  name: string;
  description?: string;  // One-line summary for object indexes
  content: string;  // Full content
  kind: OutlineKind;
  parent_id?: string | null;
  position?: number;
  language?: string;
}

export interface OutlineUpdate {
  name?: string;
  description?: string;  // One-line summary for object indexes
  content?: string;  // Full content
  parent_id?: string | null;
  position?: number;
  language?: string;
}

export interface OutlineResponse extends BaseMetadata {
  project_id: string;
  kind: OutlineKind;
  parent_id: string | null;
  name?: string;
  description?: string;  // One-line summary for object indexes
  content?: string;  // Full content
  position: number;
  manuscript_id?: string | null;
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
  thread_id?: string | null;
  archived_until_message_id?: string | null;
}

export interface ContentPart {
  type: 'content';
  text: string;
}

// ============================================================================
// UNIFIED RUN RUNTIME
// ============================================================================

export type RunType = 'agent' | 'subAgent' | 'journey';
export type RunStatus = 'running' | 'waiting' | 'processing' | 'paused' | 'done' | 'error' | 'canceled';
export type RunMode = 'planMode' | 'agentMode';
export type RunSurface = 'story-entity' | 'outline-manager' | 'novel-editor' | 'config';
export type JourneyKind =
  | 'manuscriptEdit'
  | 'outlineEdit'
  | 'objectEdit'
  | 'objectTranslation'
  | 'imagePrompt'
  | 'sceneImagePrompt'
  | 'messageTranslation';
export type RunMessageRole = 'user' | 'assistant' | 'system' | 'tool_call';
export type RunToolCallStatus = 'streaming' | 'validating' | 'pending' | 'processing' | 'working' | 'failed' | 'rejected' | 'applied';
export type RunToolCallFailureType = 'validation' | 'execution' | 'partial';

export interface AgentStartRunRequest {
  run_type: 'agent';
  agent_id: string;
  run_mode: RunMode;
  surface: RunSurface;
  input_text: string;
  language: string;
  context_object_ids?: string[];
}

export interface JourneyStartRunRequest {
  run_type: 'journey';
  journey_kind: JourneyKind;
  input_text: string;
  language: string;
  input_payload: Record<string, any>;
  journey_target_ids?: string[];
}

export type StartRunRequest = AgentStartRunRequest | JourneyStartRunRequest;

export interface RunDecisionsRequest {
  message_id: string;
  decisions: Record<string, 'accept' | 'reject' | 'cancel'>;
  options?: Record<string, any>;
}

export interface QueryRunsRequest {
  run_types?: RunType[];
  statuses?: RunStatus[];
  limit?: number;
}

export interface RunToolCallResponse extends BaseMetadata {
  run_id: string;
  message_id: string;
  llm_call_id: string;
  call_seq: number;
  tool_name: string;
  arguments: Record<string, any>;
  status: RunToolCallStatus;
  failure_type?: RunToolCallFailureType | null;
  reason?: string | null;
  result?: Record<string, any> | null;
  accepted_at?: string | null;
}

export interface RunMessageResponse extends BaseMetadata {
  run_id: string;
  seq: number;
  role: RunMessageRole;
  data: Record<string, any>;
}

export interface RunResponse extends BaseMetadata {
  user_id: string;
  project_id: string;
  run_type: RunType;
  status: RunStatus;
  language: string;
  input_text: string;
  input_payload: Record<string, any>;
  final_output?: string | null;
  error?: string | null;
  agent_id?: string | null;
  sub_agent_id?: string | null;
  run_mode?: RunMode | null;
  surface?: RunSurface | null;
  context_object_ids: string[];
  journey_kind?: JourneyKind | null;
  journey_target_ids: string[];
  parent_run_id?: string | null;
  parent_run_message_id?: string | null;
  parent_run_tool_call_id?: string | null;
  root_run_seq?: number | null;
  next_message_seq: number;
  frozen_context?: Record<string, any> | null;
}

export interface RunStateResponse {
  run: RunResponse;
}

export interface QueryRunsResponse {
  items: RunResponse[];
}

export interface AppendRunMessageRequest {
  text: string;
  language: string;
}

export interface AppendRunMessageResponse {
  ok: boolean;
  message_id: string;
}

export interface PatchRunMessageRequest {
  language: string;
  content_parts?: Array<{ type: 'content'; text: string }>;
  reasoning_detail?: Record<string, any>;
}

export interface TranslateRunMessageRequest {
  language: string;
  content_parts: Array<{ type: 'content'; text: string }>;
  reasoning_detail?: Record<string, any>;
}

export interface PatchRunMessageResponse {
  message: RunMessageResponse;
}

export interface TranslateRunMessageResponse {
  message: RunMessageResponse;
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

// ============================================================================
// ACCOUNT STORAGE
// ============================================================================

export interface ProjectStorageBreakdown {
  project_id: string;
  project_name: string;
  used_bytes: number;
  image_count: number;
  categories: {
    project_meta_bytes: number;
    story_bytes: number;
    manuscript_bytes: number;
    chat_bytes: number;
    notification_bytes: number;
    image_run_bytes: number;
    image_bytes: number;
    llm_log_bytes: number;
    total_bytes: number;
  };
}

export interface AccountStorageResponse {
  user_id: string;
  used_bytes: number;
  quota_bytes: number;
  remaining_bytes: number;
  percent_used: number;
  by_project: ProjectStorageBreakdown[];
  computed_at: string;
}

export interface AdminUserStorageItem {
  user_id: string;
  email: string;
  username: string;
  is_admin: boolean;
  used_bytes: number;
  quota_bytes: number;
  remaining_bytes: number;
  percent_used: number;
  storage_quota_bytes_override?: number | null;
  created_at: string;
}

export interface AdminUsersStorageResponse {
  users: AdminUserStorageItem[];
  total: number;
  computed_at: string;
}

export interface AdminUserUpdateRequest {
  is_admin?: boolean;
  storage_quota_bytes?: number | null;
}

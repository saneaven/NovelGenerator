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
  archived_until_message_id?: string | null;
}

export interface ContentPart {
  type: 'content' | 'thinking';
  text: string;
}

// ============================================================================
// UNIFIED RUN RUNTIME
// ============================================================================

export type RunKind = 'root' | 'child';
export type RunCaller = 'planMode' | 'agentMode' | 'subAgent';
export type RunStatus = 'running' | 'waiting' | 'paused' | 'completed' | 'error' | 'cancelled';
export type RunMode = 'planMode' | 'agentMode';
export type RunSurface = 'story-object' | 'outline-manager' | 'novel-editor' | 'config';
export type RunMessageRole = 'user' | 'assistant' | 'system';
export type RunToolCallStatus = 'pending' | 'running' | 'accepted' | 'rejected' | 'failed';
export type RunToolCallFailureType = 'validation' | 'execution' | 'partial';

export interface CreateUnifiedRunRequest {
  run_kind: RunKind;
  caller: RunCaller;
  language: string;
  input_text?: string;

  run_mode?: RunMode;
  surface?: RunSurface;
  context_object_ids?: string[];

  parent_run_id?: string;
  parent_run_message_id?: string;
  parent_run_tool_call_id?: string;
  sub_agent_id?: string;

  status?: RunStatus;
}

export interface PatchUnifiedRunRequest {
  status?: RunStatus;
  final_output?: string | null;
  error?: string | null;
}

export interface QueryRunsRequest {
  statuses?: RunStatus[];
  root_only?: boolean;
  parent_run_message_ids?: string[];
  include_messages?: boolean;
  include_tool_calls?: boolean;
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
  tool_calls: RunToolCallResponse[];
}

export interface UnifiedRunResponse extends BaseMetadata {
  project_id: string;
  agent_id: string;
  run_kind: RunKind;
  caller: RunCaller;
  status: RunStatus;
  language: string;
  input_text: string;
  final_output?: string | null;
  error?: string | null;
  run_mode?: RunMode | null;
  surface?: RunSurface | null;
  context_object_ids: string[];
  parent_run_id?: string | null;
  parent_run_message_id?: string | null;
  parent_run_tool_call_id?: string | null;
  sub_agent_id?: string | null;
  root_run_seq?: number | null;
  next_message_seq: number;
  messages: RunMessageResponse[];
}

export interface CreateUnifiedRunResponse {
  run: UnifiedRunResponse;
}

export interface PatchUnifiedRunResponse {
  run: UnifiedRunResponse;
}

export interface GetUnifiedRunResponse {
  run: UnifiedRunResponse;
}

export interface QueryRunsResponse {
  items: UnifiedRunResponse[];
}

export interface AddRunMessageRequest {
  role: RunMessageRole;
  language: string;
  content_parts?: Array<Record<string, any>>;
  thinking_details?: Array<Record<string, any>>;
}

export interface PatchRunMessageRequest {
  language: string;
  content_parts?: Array<Record<string, any>>;
  thinking_details?: Array<Record<string, any>>;
}

export interface TranslateRunMessageRequest {
  language: string;
  content_parts: Array<Record<string, any>>;
  thinking_details?: Array<Record<string, any>>;
}

export interface AddRunMessageResponse {
  message: RunMessageResponse;
}

export interface PatchRunMessageResponse {
  message: RunMessageResponse;
}

export interface TranslateRunMessageResponse {
  message: RunMessageResponse;
}

export interface UpsertRunToolCallRequestItem {
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

export interface UpsertRunToolCallsRequest {
  tool_calls: UpsertRunToolCallRequestItem[];
}

export interface UpsertRunToolCallsResponse {
  tool_calls: RunToolCallResponse[];
}

export interface TimelineChildRunSummary {
  run_id: string;
  parent_run_tool_call_id: string;
  status: RunStatus;
  final_output?: string | null;
}

export interface TimelineItem {
  root_run_id: string;
  root_run_seq: number;
  status: RunStatus;
  messages: RunMessageResponse[];
  child_runs: TimelineChildRunSummary[];
}

export interface TimelineResponse {
  items: TimelineItem[];
  next_cursor?: string | null;
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
  asset_count: number;
  used_bytes: number;
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

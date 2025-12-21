/**
 * TypeScript Interfaces for New Unified Translation System
 *
 * All story objects follow the same pattern:
 * - Structure only in core tables
 * - Content in object_translations (fast access)
 * - Version history in object_versions (source of truth)
 */

// ============================================================================
// CORE TYPES
// ============================================================================

export type ObjectType =
  | 'basic_info'
  | 'character'
  | 'organization'
  | 'location'
  | 'lorebook'
  | 'act'
  | 'chapter'
  | 'manuscript';

// ============================================================================
// UNIFIED OBJECT (Response from API)
// ============================================================================

export interface UnifiedObject<TData = Record<string, any>> {
  id: string;
  type: ObjectType;
  metadata: ObjectMetadata;
  data: Record<string, TData>;  // Language-keyed data: { "English": {...}, "Korean": {...} }
  // languages field removed - use Object.keys(data) for available, settings.mainLanguage for default
  version: VersionInfo;
}

// Helper functions for working with language-keyed data
export function getAvailableLanguages<TData>(obj: UnifiedObject<TData>): string[] {
  return Object.keys(obj.data);
}

export function getDataForLanguage<TData>(obj: UnifiedObject<TData>, language: string): TData | undefined {
  return obj.data[language];
}

export function hasLanguage<TData>(obj: UnifiedObject<TData>, language: string): boolean {
  return language in obj.data;
}

// ============================================================================
// METADATA (Structure)
// ============================================================================

export interface ObjectMetadata {
  id: string;
  created_at: string;
  updated_at: string;
  // Parent IDs (depends on object type)
  project_id?: string;
  outline_id?: string;
  act_id?: string;
  chapter_id?: string;
  // Structural data
  order?: number;  // For acts and chapters
  // Image prompts (for story objects: character, location, organization, lorebook)
  image_prompt?: string | null;  // Natural language prompt
  image_prompt_positive?: string | null;  // Tag-based positive (NovelAI)
  image_prompt_negative?: string | null;  // Tag-based negative (NovelAI)
  // Cover image (for basic_info only)
  cover_image_id?: string | null;
  cover_image_url?: string | null;
}

// ============================================================================
// VERSION INFO
// ============================================================================

export interface VersionInfo {
  id: string;
  number: number;
  created_at: string;
}

export interface VersionHistoryEntry {
  id: string;
  number: number;
  data: Record<string, Record<string, any>>;  // {language: {field: value}}
  user_request: string | null;
  created_at: string;
}

// ============================================================================
// SPECIFIC OBJECT DATA TYPES
// ============================================================================

export interface BasicInfoData {
  title: string;
  logline: string;
  genre: string;
}

export interface CharacterData {
  name: string;
  description: string;
}

export interface OrganizationData {
  name: string;
  description: string;
}

export interface LocationData {
  name: string;
  description: string;
}

export interface LorebookEntryData {
  name: string;
  description: string;
}

export interface ActData {
  name: string;
  description: string;
}

export interface ChapterData {
  name: string;
  description: string;
}

export interface ManuscriptData {
  content: string;
  wordCount: number;
}

// ============================================================================
// TYPED UNIFIED OBJECTS
// ============================================================================

export type BasicInfoObject = UnifiedObject<BasicInfoData>;
export type CharacterObject = UnifiedObject<CharacterData>;
export type OrganizationObject = UnifiedObject<OrganizationData>;
export type LocationObject = UnifiedObject<LocationData>;
export type LorebookEntryObject = UnifiedObject<LorebookEntryData>;
export type ActObject = UnifiedObject<ActData>;
export type ChapterObject = UnifiedObject<ChapterData>;
export type ManuscriptObject = UnifiedObject<ManuscriptData>;

// ============================================================================
// REQUEST TYPES
// ============================================================================

export interface UpdateObjectRequest<TData = Record<string, any>> {
  data: TData;
  language: string;
  user_request?: string;
  create_new_version?: boolean;  // Default: true
}

export interface AddTranslationRequest<TData = Record<string, any>> {
  language: string;
  data: TData;
  user_request?: string;
}

export interface CreateObjectRequest<TData = Record<string, any>> {
  data: TData;
  language: string;
  user_request?: string;
  metadata?: Record<string, any>;
}

export interface SwitchLanguageRequest {
  language: string;
}

// ============================================================================
// TRANSLATION STATUS
// ============================================================================

export interface TranslationStatus {
  object_id: string;
  object_type: ObjectType;
  available_languages: string[];
  missing_languages: string[];
  translation_coverage: number;  // Percentage
}

export interface LanguageCoverage {
  language: string;
  object_count: number;
  total_objects: number;
  coverage_percentage: number;
}

export interface ProjectTranslationStatus {
  translation_status: TranslationStatus[];
}

export interface ProjectLanguageCoverage {
  total_objects: number;
  language_coverage: LanguageCoverage[];
}

// ============================================================================
// HELPER TYPES
// ============================================================================

export interface LanguageDetails {
  language: string;
  is_active: boolean;
  updated_at: string;
}

export interface ObjectLanguagesResponse {
  object_id: string;
  object_type: ObjectType;
  languages: LanguageDetails[];
  active_language: string | null;
}

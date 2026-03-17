/**
 * TypeScript Interfaces for New Unified Translation System
 *
 * All story entities follow the same pattern:
 * - Structure only in core tables
 * - Content in object_versions (source of truth)
 */

import type { TipTapDoc } from './tiptap';

// ============================================================================
// CORE TYPES
// ============================================================================

export type ObjectType =
  | 'basic_info'
  | 'guidelines'
  | 'story_entity_folder'
  | 'story_entity'
  | 'outline'
  | 'manuscript';

export type StoryEntityKind = 'character' | 'organization' | 'location' | 'lorebook';
export type OutlineKind = 'outline' | 'act' | 'chapter';

// ============================================================================
// UNIFIED OBJECT (Response from API)
// ============================================================================

export interface UnifiedObject<TData = Record<string, any>> {
  id: string;
  type: ObjectType;
  kind?: StoryEntityKind | OutlineKind;
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
  project_id?: string;
  parent_id?: string | null;
  chapter_id?: string;
  manuscript_id?: string;
  folder_id?: string | null;
  position?: number;
  display_order?: number; // For story entities and folders
  // Image prompts (for story objects: character, location, organization, lorebook)
  image_prompt?: string | null;  // Natural language prompt
  image_prompt_positive?: string | null;  // Tag-based positive (NovelAI)
  image_prompt_negative?: string | null;  // Tag-based negative (NovelAI)
  // Cover image (for basic_info only) - URL resolved at runtime using getAssetUrl utility
  cover_image_id?: string | null;
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
  genres: string[];
  tags: string[];
}

/**
 * Unified data type for story entities and outline objects
 */
export interface StoryEntityData {
  name: string;          // Object name
  description: string;   // One-line summary for object indexes
  content: string;       // Full content
}

export type StoryObjectData = StoryEntityData;

export interface ManuscriptData {
  doc: TipTapDoc;
  wordCount: number;
}

export interface GuidelinesData {
  authorNote: string;
}

export interface StoryEntityFolderData {
  name: string;
  description: string;
}

// ============================================================================
// TYPED UNIFIED OBJECTS
// ============================================================================

export type BasicInfoObject = UnifiedObject<BasicInfoData> & { type: 'basic_info' };
export type StoryEntityFolderObject = UnifiedObject<StoryEntityFolderData> & { type: 'story_entity_folder' };
export type StoryEntityObject = UnifiedObject<StoryEntityData> & { type: 'story_entity'; kind: StoryEntityKind };
export type StoryObject = StoryEntityObject;
export type ManuscriptObject = UnifiedObject<ManuscriptData> & { type: 'manuscript' };
export type GuidelinesObject = UnifiedObject<GuidelinesData> & { type: 'guidelines' };
export type OutlineObject = UnifiedObject<StoryEntityData> & { type: 'outline'; kind: OutlineKind };
export type ActObject = OutlineObject & { kind: 'act' };
export type ChapterObject = OutlineObject & { kind: 'chapter' };

// ============================================================================
// REQUEST TYPES
// ============================================================================

export interface UpdateObjectRequest<TData = Record<string, any>> {
  data: TData;
  language: string;
  kind?: StoryEntityKind | OutlineKind;
  user_request?: string;
  create_new_version?: boolean;  // Default: true
  metadata?: Record<string, any>;
}

export interface AddTranslationRequest<TData = Record<string, any>> {
  language: string;
  data: TData;
  user_request?: string;
}

export interface CreateObjectRequest<TData = Record<string, any>> {
  data: TData;
  language: string;
  kind?: StoryEntityKind | OutlineKind;
  user_request?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// TRANSLATION STATUS
// ============================================================================

export interface TranslationStatus {
  object_id: string;
  object_type: ObjectType;
  kind?: StoryEntityKind | OutlineKind;
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

/**
 * API Service for Unified Object System
 *
 * All story objects use the same endpoints:
 * - GET /api/v1/objects/{type}/{id}?language={lang}
 * - PUT /api/v1/objects/{type}/{id}
 * - POST /api/v1/objects/{type}/{id}/translations
 * - PATCH /api/v1/objects/{type}/{id}/active-language
 * - GET /api/v1/objects/{type}/{id}/versions
 * - PATCH /api/v1/objects/{type}/{id}/versions/{version_id}/activate
 */

import { apiClient } from './client';
import type {
  UnifiedObject,
  ObjectType,
  UpdateObjectRequest,
  AddTranslationRequest,
  SwitchLanguageRequest,
  VersionHistoryEntry,
  ProjectTranslationStatus,
  ProjectLanguageCoverage,
  ObjectLanguagesResponse,
  CreateObjectRequest
} from '../types/unifiedObject';

type QueryParamValue = string | number | boolean | null | undefined;
type QueryParamRecord = Record<
  string,
  QueryParamValue | QueryParamValue[] | undefined
>;

const buildQueryString = (params: QueryParamRecord = {}) => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null) {
          return;
        }
        searchParams.append(key, String(item));
      });
    } else {
      searchParams.append(key, String(value));
    }
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
};

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

export const unifiedObjectService = {
  /**
   * Get object in specified language
   * @param type Object type
   * @param id Object ID
   * @param language Language code (optional - uses active language if not specified)
   */
  async getObject<TData = Record<string, any>>(
    type: ObjectType,
    id: string,
    language?: string
  ): Promise<UnifiedObject<TData>> {
    const query = buildQueryString({ language });
    return apiClient.get<UnifiedObject<TData>>(`/api/v1/objects/${type}/${id}${query}`);
  },

  /**
   * Update object in specified language
   * @param type Object type
   * @param id Object ID
   * @param request Update request with data and language
   */
  async updateObject<TData = Record<string, any>>(
    type: ObjectType,
    id: string,
    request: UpdateObjectRequest<TData>
  ): Promise<UnifiedObject<TData>> {
    return apiClient.put<UnifiedObject<TData>>(`/api/v1/objects/${type}/${id}`, request);
  },

  /**
   * Add new language translation
   * @param type Object type
   * @param id Object ID
   * @param request Translation request with language and data
   */
  async addTranslation<TData = Record<string, any>>(
    type: ObjectType,
    id: string,
    request: AddTranslationRequest<TData>
  ): Promise<{ message: string; version_id: string }> {
    return apiClient.post<{ message: string; version_id: string }>(
      `/api/v1/objects/${type}/${id}/translations`,
      request
    );
  },

  /**
   * Switch active language WITHOUT creating new version
   * @param type Object type
   * @param id Object ID
   * @param request Language switch request
   */
  async switchActiveLanguage(
    type: ObjectType,
    id: string,
    request: SwitchLanguageRequest
  ): Promise<{ message: string }> {
    return apiClient.patch<{ message: string }>(
      `/api/v1/objects/${type}/${id}/active-language`,
      request
    );
  },

  /**
   * Get version history for an object
   * @param type Object type
   * @param id Object ID
   */
  async getVersions(type: ObjectType, id: string): Promise<VersionHistoryEntry[]> {
    return apiClient.get<VersionHistoryEntry[]>(`/api/v1/objects/${type}/${id}/versions`);
  },

  /**
   * Restore a previous version by creating a NEW version with the restored content.
   * The restored content becomes the latest version.
   * @param type Object type
   * @param id Object ID
   * @param versionId Version ID to restore
   */
  async restoreVersion(
    type: ObjectType,
    id: string,
    versionId: string
  ): Promise<{ message: string; version_id: string }> {
    return apiClient.patch<{ message: string; version_id: string }>(
      `/api/v1/objects/${type}/${id}/versions/${versionId}/activate`
    );
  },

  /**
   * Get list of available languages for an object
   * @param type Object type
   * @param id Object ID
   */
  async getObjectLanguages(type: ObjectType, id: string): Promise<ObjectLanguagesResponse> {
    return apiClient.get<ObjectLanguagesResponse>(`/api/v1/objects/${type}/${id}/languages`);
  },

  /**
   * Delete a translation for a specific language
   * @param type Object type
   * @param id Object ID
   * @param language Language to delete
   */
  async deleteTranslation(
    type: ObjectType,
    id: string,
    language: string
  ): Promise<{ message: string }> {
    return apiClient.delete<{ message: string }>(
      `/api/v1/objects/${type}/${id}/translations/${language}`
    );
  },

  // ============================================================================
  // LIST & COLLECTION OPERATIONS
  // ============================================================================

  /**
   * List all objects of a specific type for a project
   * @param type Object type
   * @param projectId Project ID
   * @param options Optional parameters (language, pagination)
   */
  async listObjects<TData = Record<string, any>>(
    type: ObjectType,
    projectId: string,
    options?: {
      language?: string;
      page?: number;
      page_size?: number;
    }
  ): Promise<{
    objects: UnifiedObject<TData>[];
    total: number;
    page: number;
    page_size: number;
  }> {
    const query = buildQueryString({
      language: options?.language,
      page: options?.page || 1,
      page_size: options?.page_size || 50,
    });

    return apiClient.get<{
      objects: UnifiedObject<TData>[];
      total: number;
      page: number;
      page_size: number;
    }>(`/api/v1/projects/${projectId}/objects/${type}${query}`);
  },

  /**
   * Create a new object
   * @param type Object type
   * @param projectId Project ID
   * @param request Create request with initial data and language
   */
  async createObject<TData = Record<string, any>>(
    type: ObjectType,
    projectId: string,
    request: CreateObjectRequest<TData>
  ): Promise<UnifiedObject<TData>> {
    return apiClient.post<UnifiedObject<TData>>(
      `/api/v1/projects/${projectId}/objects/${type}`,
      request
    );
  },

  /**
   * Delete an object and all its translations/versions
   * @param type Object type
   * @param id Object ID
   */
  async deleteObject(type: ObjectType, id: string): Promise<{ success: boolean; message: string }> {
    return apiClient.delete<{ success: boolean; message: string }>(
      `/api/v1/objects/${type}/${id}`
    );
  },

  /**
   * Update image prompts for a story object
   * @param type Object type (character, location, organization, lorebook)
   * @param id Object ID
   * @param prompts Image prompt data
   */
  async updateImagePrompt(
    type: ObjectType,
    id: string,
    prompts: {
      image_prompt?: string;
      image_prompt_positive?: string;
      image_prompt_negative?: string;
    }
  ): Promise<{
    success: boolean;
    image_prompt: string | null;
    image_prompt_positive: string | null;
    image_prompt_negative: string | null;
  }> {
    return apiClient.patch<{
      success: boolean;
      image_prompt: string | null;
      image_prompt_positive: string | null;
      image_prompt_negative: string | null;
    }>(`/api/v1/objects/${type}/${id}/image-prompt`, prompts);
  },

  /**
   * Reorder objects of a specific type within a project
   * @param type Object type (character, organization, location, lorebook)
   * @param projectId Project ID
   * @param objectIds Array of object IDs in desired order
   */
  async reorderObjects(
    type: ObjectType,
    projectId: string,
    objectIds: string[]
  ): Promise<{ success: boolean; message: string }> {
    return apiClient.patch<{ success: boolean; message: string }>(
      `/api/v1/projects/${projectId}/objects/${type}/reorder`,
      { object_ids: objectIds }
    );
  },

};

// ============================================================================
// TRANSLATION MANAGEMENT
// ============================================================================

export const translationService = {
  /**
   * Get translation status for all objects in a project
   * @param projectId Project ID
   * @param targetLanguages Optional list of target languages to check
   */
  async getProjectTranslationStatus(
    projectId: string,
    targetLanguages?: string[]
  ): Promise<ProjectTranslationStatus> {
    const query = buildQueryString(
      targetLanguages && targetLanguages.length
        ? { target_languages: targetLanguages }
        : {}
    );

    return apiClient.get<ProjectTranslationStatus>(
      `/api/v1/projects/${projectId}/translation-status${query}`
    );
  },

  /**
   * Get language coverage statistics for a project
   * @param projectId Project ID
   */
  async getLanguageCoverage(projectId: string): Promise<ProjectLanguageCoverage> {
    return apiClient.get<ProjectLanguageCoverage>(
      `/api/v1/projects/${projectId}/language-coverage`
    );
  },

  /**
   * Batch delete translations for a specific language
   * @param objectType Object type
   * @param objectIds Array of object IDs
   * @param language Language to delete
   */
  async batchDeleteTranslations(
    objectType: ObjectType,
    objectIds: string[],
    language: string
  ): Promise<{ message: string; deleted_count: number }> {
    return apiClient.post<{ message: string; deleted_count: number }>(
      '/api/v1/batch/delete-translations',
      {
        object_type: objectType,
        object_ids: objectIds,
        language,
      }
    );
  },

  /**
   * Add translations for one or more objects (unified endpoint)
   * Returns updated objects for immediate store update (no separate GET needed)
   * @param translations Array of translation data (can be 1 or many objects)
   */
  async addTranslations(
    translations: Array<{
      objectType: ObjectType;
      objectId: string;
      language: string;
      data: Record<string, any>;
      targetVersionNumber?: number;
    }>
  ): Promise<{
    success: boolean;
    translated_count: number;
    message: string;
    objects: UnifiedObject[];
  }> {
    return apiClient.post<{
      success: boolean;
      translated_count: number;
      message: string;
      objects: UnifiedObject[];
    }>(
      '/api/v1/translations',
      {
        translations: translations.map(t => ({
          object_type: t.objectType,
          object_id: t.objectId,
          language: t.language,
          data: t.data,
          target_version_number: t.targetVersionNumber,
        })),
        user_request: 'Translation',
      }
    );
  },
};

export default unifiedObjectService;

/**
 * Asset service for image management and generation
 */

import apiClient from './client';

// Helper to format StyledPrompt for display
export function formatStyledPrompt(prompt: StyledPrompt | null): string {
    if (!prompt) return '';
    return [prompt.prefix, prompt.content, prompt.postfix].filter(Boolean).join('');
}

/**
 * Structured prompt with style components (matches backend StyledPrompt schema)
 */
export interface StyledPrompt {
    prefix: string;
    content: string;
    postfix: string;
}

// Types
// Reference object stored in asset metadata
export interface ReferenceObjectData {
    id: string;
    type: string;  // 'character', 'location', 'organization', 'lorebook'
    name: string;
}

export type AssetType = 'scene' | 'object' | 'cover' | null;

export interface Asset {
    id: string;
    project_id: string;
    manuscript_id: string | null;  // Ownership for scene assets
    name: string;
    file_path: string;
    thumbnail_path: string | null;
    mime_type: string;
    asset_type: AssetType;  // 'scene', 'object', or null
    // Prompts stored separately by provider type (StyledPrompt with prefix/content/postfix)
    generation_prompt: StyledPrompt | null;  // Natural language prompt (OpenAI, Gemini, xAI)
    generation_positive_prompt: StyledPrompt | null;  // Positive prompt for tag-based (NovelAI)
    generation_negative_prompt: StyledPrompt | null;  // Negative prompt for tag-based (NovelAI)
    generation_provider: string | null;
    generation_model: string | null;
    generation_settings: Record<string, any> | null;  // Provider-specific settings
    generation_reference_images: ReferenceImage[] | null;  // Reference images used during generation
    generation_reference_objects: ReferenceObjectData[] | null;  // Story objects referenced during generation
    width: number | null;
    height: number | null;
    file_size: number | null;
    created_at: string;
    updated_at: string;
    file_url: string;
    thumbnail_url: string | null;
}

export interface AssetListResponse {
    assets: Asset[];
    total: number;
}

export interface StoryObjectAsset {
    id: string;
    object_type: string;
    object_id: string;
    asset_id: string;
    is_main: boolean;
    display_order: number;
    created_at: string;
    asset: Asset;
}

export interface StoryObjectAssetsResponse {
    assets: StoryObjectAsset[];
    main_asset: StoryObjectAsset | null;
}

// Manuscript Asset Usage types (for scene asset tracking)
export interface ManuscriptInfo {
    id: string;
    name: string;  // Chapter name
    act_name: string | null;
}

export interface SceneAsset extends Omit<Asset, 'generation_settings' | 'generation_reference_objects' | 'generation_reference_images'> {
    manuscript_id: string | null;  // Ownership
    used_in_manuscripts: ManuscriptInfo[];
    usage_count: number;
}

export interface SceneAssetsResponse {
    assets: SceneAsset[];
    total: number;
}

// Image cleanup types
export interface ImageCleanupPolicy {
    delete_non_main_story_object_images: boolean;
    delete_unused_manuscript_images: boolean;
    keep_recent_days: number;
    treat_reference_images_as_used: boolean;
}

export interface ImageCleanupPreviewItem {
    asset_id: string;
    name: string;
    asset_type: AssetType;
    manuscript_id: string | null;
    created_at: string;
    file_size: number | null;
    file_url: string;
    thumbnail_url: string | null;
    reasons: string[];
    referenced_by_count: number;
}

export interface ImageCleanupPreviewResponse {
    candidates: ImageCleanupPreviewItem[];
    total_candidates: number;
    total_size_bytes: number;
}

export interface ImageCleanupExecuteRequest {
    policy: ImageCleanupPolicy;
    asset_ids: string[];
}

export interface ImageCleanupExecuteSkipped {
    asset_id: string;
    reason: string;
}

export interface ImageCleanupExecuteError {
    asset_id: string;
    error: string;
}

export interface ImageCleanupExecuteResponse {
    deleted: string[];
    skipped: ImageCleanupExecuteSkipped[];
    errors: ImageCleanupExecuteError[];
    scrubbed_reference_entries: number;
}

export interface RebuildManuscriptImagesResponse {
    manuscripts_processed: number;
    languages_processed: number;
    images_deleted: number;
    images_inserted: number;
    unresolved_refs: number;
}

export type PromptType = 'natural' | 'tag_based';

export interface ImageProvider {
    name: string;
    display_name: string;
    prompt_type: PromptType;
    supported_sizes: string[];
    supported_qualities: string[];
    supported_styles: string[];
    settings_schema: Record<string, any> | null;
    supports_image_input: boolean;  // Whether provider supports image-to-image generation
}

// Reference image for image-to-image generation
export interface ReferenceImage {
    asset_id: string;
    strength: number;  // 0-1, how much to use this reference
}

export const assetService = {
    /**
     * List available image providers
     */
    async listImageProviders(): Promise<ImageProvider[]> {
        const response = await apiClient.get<{ providers: ImageProvider[] }>('/api/v1/assets/image-providers');
        return response.providers;
    },

    /**
     * Get available models for a provider
     */
    async getImageModels(provider: string, apiKey: string): Promise<{ id: string; name: string }[]> {
        const formData = new FormData();
        formData.append('api_key', apiKey);
        const response = await apiClient.postFormData<{ data: { id: string; name: string }[] }>(
            `/api/v1/assets/image-providers/${provider}/models`,
            formData
        );
        return response.data;
    },

    /**
     * List all assets for a project
     */
    async listAssets(projectId: string): Promise<Asset[]> {
        const response = await apiClient.get<AssetListResponse>(`/api/v1/assets/${projectId}`);
        return response.assets;
    },

    /**
     * Upload an image asset
     */
    async uploadAsset(
        projectId: string,
        file: File,
        name?: string,
        assetType?: 'scene' | 'object',
        binding?: { manuscriptId?: string; objectType?: string; objectId?: string }
    ): Promise<Asset> {
        const formData = new FormData();
        formData.append('file', file);
        if (name) {
            formData.append('name', name);
        }
        if (assetType) {
            formData.append('asset_type', assetType);
        }

        const params = new URLSearchParams();
        if (binding?.manuscriptId) {
            params.set('manuscript_id', binding.manuscriptId);
        }
        if (binding?.objectType) {
            params.set('object_type', binding.objectType);
        }
        if (binding?.objectId) {
            params.set('object_id', binding.objectId);
        }
        const suffix = params.toString() ? `?${params.toString()}` : '';
        return apiClient.postFormData<Asset>(`/api/v1/assets/${projectId}/upload${suffix}`, formData);
    },

    /**
     * Get a specific asset
     */
    async getAsset(projectId: string, assetId: string): Promise<Asset> {
        return apiClient.get<Asset>(`/api/v1/assets/${projectId}/${assetId}`);
    },

    /**
     * Find an asset by its file URL
     * Used to look up asset metadata from image src in editor
     */
    async getAssetByUrl(projectId: string, fileUrl: string): Promise<Asset | null> {
        try {
            // Extract path from full URL (e.g., "https://example.com/storage/assets/xxx.png" -> "/storage/assets/xxx.png")
            let urlPath: string;
            try {
                urlPath = new URL(fileUrl).pathname;
            } catch {
                // If not a valid URL, assume it's already a path
                urlPath = fileUrl;
            }

            const assets = await this.listAssets(projectId);
            return assets.find((a) => a.file_url === urlPath) || null;
        } catch {
            return null;
        }
    },

    /**
     * Update asset metadata
     */
    async updateAsset(projectId: string, assetId: string, name: string): Promise<Asset> {
        return apiClient.patch<Asset>(`/api/v1/assets/${projectId}/${assetId}`, { name });
    },

    /**
     * Delete an asset
     */
    async deleteAsset(projectId: string, assetId: string): Promise<void> {
        await apiClient.delete<void>(`/api/v1/assets/${projectId}/${assetId}`);
    },

    // Story Object Assets

    /**
     * Get assets for a story object
     */
    async getStoryObjectAssets(
        projectId: string,
        objectType: string,
        objectId: string
    ): Promise<StoryObjectAssetsResponse> {
        return apiClient.get<StoryObjectAssetsResponse>(
            `/api/v1/assets/${projectId}/object/${objectType}/${objectId}`
        );
    },

    /**
     * Set main asset for a story object
     */
    async setMainAsset(
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string
    ): Promise<StoryObjectAsset> {
        return apiClient.patch<StoryObjectAsset>(
            `/api/v1/assets/${projectId}/object/${objectType}/${objectId}/main`,
            { asset_id: assetId }
        );
    },

    // Scene Assets

    /**
     * List all scene assets with manuscript usage information
     */
    async listSceneAssets(projectId: string, manuscriptId?: string): Promise<SceneAssetsResponse> {
        const url = manuscriptId
            ? `/api/v1/assets/${projectId}/scene?manuscript_id=${manuscriptId}`
            : `/api/v1/assets/${projectId}/scene`;
        return apiClient.get<SceneAssetsResponse>(url);
    },

    // Image Cleanup

    async previewImageCleanup(projectId: string, policy: ImageCleanupPolicy): Promise<ImageCleanupPreviewResponse> {
        return apiClient.post<ImageCleanupPreviewResponse>(`/api/v1/assets/${projectId}/cleanup/preview`, policy);
    },

    async executeImageCleanup(projectId: string, request: ImageCleanupExecuteRequest): Promise<ImageCleanupExecuteResponse> {
        return apiClient.post<ImageCleanupExecuteResponse>(`/api/v1/assets/${projectId}/cleanup/execute`, request);
    },

    async rebuildManuscriptImagesIndex(projectId: string): Promise<RebuildManuscriptImagesResponse> {
        return apiClient.post<RebuildManuscriptImagesResponse>(`/api/v1/assets/${projectId}/cleanup/rebuild-manuscript-images`);
    },
};

export default assetService;

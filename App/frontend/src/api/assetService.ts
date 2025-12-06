/**
 * Asset service for image management and generation
 */

import apiClient from './client';

// Types
// Reference object stored in asset metadata
export interface ReferenceObjectData {
    id: string;
    type: string;  // 'character', 'location', 'organization', 'lorebook'
    name: string;
}

export type AssetType = 'scene' | 'object' | null;

export interface Asset {
    id: string;
    project_id: string;
    name: string;
    file_path: string;
    thumbnail_path: string | null;
    mime_type: string;
    asset_type: AssetType;  // 'scene', 'object', or null
    // Prompts stored separately by provider type
    generation_prompt: string | null;  // Natural language prompt (OpenAI, Gemini, xAI)
    generation_positive_prompt: string | null;  // Positive prompt for tag-based (NovelAI)
    generation_negative_prompt: string | null;  // Negative prompt for tag-based (NovelAI)
    generation_provider: string | null;
    generation_model: string | null;
    generation_settings: Record<string, any> | null;  // Provider-specific settings
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

// Chapter Asset types (for scene asset tracking)
export interface ChapterInfo {
    id: string;
    name: string;
    act_name: string | null;
}

export interface ChapterAsset {
    id: string;
    chapter_id: string;
    asset_id: string;
    created_at: string;
    asset: Asset;
}

export interface ChapterAssetsResponse {
    assets: ChapterAsset[];
}

export interface SceneAsset extends Omit<Asset, 'generation_settings' | 'generation_reference_objects'> {
    used_in_chapters: ChapterInfo[];
    usage_count: number;
}

export interface SceneAssetsResponse {
    assets: SceneAsset[];
    total: number;
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

// Reference object for generation (stored in metadata)
export interface ReferenceObject {
    id: string;
    type: string;  // 'character', 'location', 'organization', 'lorebook'
    name: string;
}

export interface ImageGenerationRequest {
    // For natural language providers (OpenAI, Gemini, xAI)
    prompt?: string;

    // For tag-based providers (NovelAI)
    positive_prompt?: string;
    negative_prompt?: string;

    provider: string;
    model: string;
    size?: string;
    quality?: string;
    style?: string;

    // Provider-specific settings (e.g., sampler/steps for NovelAI, aspect_ratio/resolution for Gemini)
    provider_settings?: Record<string, any>;

    // Reference images for image-to-image generation (OpenAI GPT-Image, Gemini)
    reference_images?: ReferenceImage[];

    // Reference objects used (stored in Asset metadata)
    reference_objects?: ReferenceObject[];

    // Asset type for categorization ('scene' from SceneImageGeneratorModal, 'object' from AssetManager)
    asset_type?: 'scene' | 'object';
}

export interface ImageGenerationResponse {
    success: boolean;
    asset_id?: string;
    file_path?: string;
    thumbnail_path?: string;
    revised_prompt?: string;
    error?: string;
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
     * Generate an image
     */
    async generateImage(
        projectId: string,
        request: ImageGenerationRequest,
        apiKey: string
    ): Promise<ImageGenerationResponse> {
        // Send api_key in request body (consistent with LLM endpoints)
        const response = await apiClient.post<ImageGenerationResponse>(
            `/api/v1/assets/${projectId}/generate`,
            { ...request, api_key: apiKey }
        );
        return response;
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
        assetType?: 'scene' | 'object'
    ): Promise<Asset> {
        const formData = new FormData();
        formData.append('file', file);
        if (name) {
            formData.append('name', name);
        }
        if (assetType) {
            formData.append('asset_type', assetType);
        }
        return apiClient.postFormData<Asset>(`/api/v1/assets/${projectId}/upload`, formData);
    },

    /**
     * Get a specific asset
     */
    async getAsset(projectId: string, assetId: string): Promise<Asset> {
        return apiClient.get<Asset>(`/api/v1/assets/${projectId}/${assetId}`);
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
     * Link an asset to a story object
     */
    async linkAssetToObject(
        projectId: string,
        objectType: string,
        objectId: string,
        assetId: string,
        isMain: boolean = false
    ): Promise<StoryObjectAsset> {
        return apiClient.post<StoryObjectAsset>(
            `/api/v1/assets/${projectId}/object/${objectType}/${objectId}`,
            { asset_id: assetId, is_main: isMain }
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

    /**
     * Unlink an asset from a story object
     */
    async unlinkAssetFromObject(
        projectId: string,
        objectType: string,
        objectId: string,
        linkId: string
    ): Promise<void> {
        await apiClient.delete<void>(
            `/api/v1/assets/${projectId}/object/${objectType}/${objectId}/${linkId}`
        );
    },

    // Scene Assets

    /**
     * List all scene assets with chapter usage information
     */
    async listSceneAssets(projectId: string): Promise<SceneAssetsResponse> {
        return apiClient.get<SceneAssetsResponse>(`/api/v1/assets/${projectId}/scene`);
    },

    // Chapter Assets

    /**
     * Get all assets linked to a chapter
     */
    async getChapterAssets(projectId: string, chapterId: string): Promise<ChapterAssetsResponse> {
        return apiClient.get<ChapterAssetsResponse>(
            `/api/v1/assets/${projectId}/chapter/${chapterId}/assets`
        );
    },

    /**
     * Link an asset to a chapter
     */
    async linkAssetToChapter(
        projectId: string,
        chapterId: string,
        assetId: string
    ): Promise<ChapterAsset> {
        return apiClient.post<ChapterAsset>(
            `/api/v1/assets/${projectId}/chapter/${chapterId}`,
            { asset_id: assetId }
        );
    },

    /**
     * Unlink an asset from a chapter
     */
    async unlinkAssetFromChapter(
        projectId: string,
        chapterId: string,
        assetId: string
    ): Promise<void> {
        await apiClient.delete<void>(
            `/api/v1/assets/${projectId}/chapter/${chapterId}/${assetId}`
        );
    },
};

export default assetService;

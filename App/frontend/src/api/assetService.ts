/**
 * Asset service for image management and generation
 */

import apiClient from './client';

// Types
export interface Asset {
    id: string;
    project_id: string;
    name: string;
    file_path: string;
    thumbnail_path: string | null;
    mime_type: string;
    // Prompts stored separately by provider type
    generation_prompt: string | null;  // Natural language prompt (OpenAI, Gemini, xAI)
    generation_positive_prompt: string | null;  // Positive prompt for tag-based (NovelAI)
    generation_negative_prompt: string | null;  // Negative prompt for tag-based (NovelAI)
    generation_provider: string | null;
    generation_model: string | null;
    generation_settings: Record<string, any> | null;  // Provider-specific settings
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

export type PromptType = 'natural' | 'tag_based';

export interface ImageProvider {
    name: string;
    display_name: string;
    prompt_type: PromptType;
    supported_sizes: string[];
    supported_qualities: string[];
    supported_styles: string[];
    settings_schema: Record<string, any> | null;
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
    async uploadAsset(projectId: string, file: File, name?: string): Promise<Asset> {
        const formData = new FormData();
        formData.append('file', file);
        if (name) {
            formData.append('name', name);
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
};

export default assetService;

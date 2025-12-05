/**
 * Image Generation Service
 * Async generator pattern for streaming-ready architecture
 */

import apiClient from '../api/client';
import type {
    ProcessedImageRequest,
    ImageGenerationProgress,
    ImageGenerationResult,
} from './types';

interface GenerateImageOptions {
    signal?: AbortSignal;
}

interface ApiGenerationResponse {
    success: boolean;
    asset_id?: string;
    file_path?: string;
    thumbnail_path?: string;
    revised_prompt?: string;
    error?: string;
}

/**
 * Generate an image using the async generator pattern
 *
 * Currently yields progress stages and returns result at end.
 * Structure allows easy upgrade to real streaming when providers support it.
 */
export async function* generateImage(
    projectId: string,
    request: ProcessedImageRequest,
    apiKey: string,
    options?: GenerateImageOptions
): AsyncGenerator<ImageGenerationProgress, ImageGenerationResult, undefined> {
    // Stage 1: Preparing
    yield {
        stage: 'preparing',
        message: 'Preparing image generation request...',
    };

    // Check for abort
    if (options?.signal?.aborted) {
        return {
            success: false,
            error: 'Request cancelled',
        };
    }

    // Stage 2: Generating
    yield {
        stage: 'generating',
        message: 'Generating image...',
    };

    try {
        // Make the API call
        // Note: apiClient doesn't support AbortSignal, abort is handled via checks before/after
        const requestPayload = { ...request, api_key: apiKey };

        // Debug logging
        console.group('🖼️ Image Generation Request');
        console.log('Endpoint:', `/api/v1/assets/${projectId}/generate`);
        console.log('Provider:', request.provider);
        console.log('Model:', request.model);
        console.log('Size:', request.size);
        console.log('Prompt:', request.prompt);
        if (request.positive_prompt) console.log('Positive Prompt:', request.positive_prompt);
        if (request.negative_prompt) console.log('Negative Prompt:', request.negative_prompt);
        if (request.provider_settings) console.log('Provider Settings:', request.provider_settings);
        if (request.reference_images?.length) console.log('Reference Images:', request.reference_images);
        console.log('Full Payload:', { ...requestPayload, api_key: '[REDACTED]' });
        console.groupEnd();

        const response = await apiClient.post<ApiGenerationResponse>(
            `/api/v1/assets/${projectId}/generate`,
            requestPayload
        );

        // Debug logging for response
        console.group('🖼️ Image Generation Response');
        console.log('Success:', response.success);
        if (response.success) {
            console.log('Asset ID:', response.asset_id);
            console.log('File Path:', response.file_path);
            if (response.revised_prompt) console.log('Revised Prompt:', response.revised_prompt);
        } else {
            console.error('Error:', response.error);
        }
        console.groupEnd();

        // Check for abort after API call
        if (options?.signal?.aborted) {
            return {
                success: false,
                error: 'Request cancelled',
            };
        }

        // Stage 3: Processing
        yield {
            stage: 'processing',
            message: 'Processing result...',
        };

        // Return the result
        if (!response.success) {
            return {
                success: false,
                error: response.error || 'Image generation failed',
            };
        }

        return {
            success: true,
            assetId: response.asset_id,
            filePath: response.file_path,
            thumbnailPath: response.thumbnail_path,
            revisedPrompt: response.revised_prompt,
        };
    } catch (error) {
        // Handle abort
        if (error instanceof Error && error.name === 'AbortError') {
            return {
                success: false,
                error: 'Request cancelled',
            };
        }

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error occurred',
        };
    }
}

/**
 * Fetch full asset details after generation
 */
export async function fetchAsset(projectId: string, assetId: string): Promise<AssetResponse> {
    return apiClient.get<AssetResponse>(`/api/v1/assets/${projectId}/${assetId}`);
}

// Asset response type (matching backend)
interface AssetResponse {
    id: string;
    project_id: string;
    name: string;
    file_path: string;
    thumbnail_path: string | null;
    mime_type: string;
    generation_prompt: string | null;
    generation_positive_prompt: string | null;
    generation_negative_prompt: string | null;
    generation_provider: string | null;
    generation_model: string | null;
    generation_settings: Record<string, unknown> | null;
    generation_reference_objects: Array<{ id: string; type: string; name: string }> | null;
    width: number | null;
    height: number | null;
    file_size: number | null;
    created_at: string;
    updated_at: string;
    file_url: string;
    thumbnail_url: string | null;
}

/**
 * List available image providers
 */
export async function listImageProviders(): Promise<ImageProviderInfo[]> {
    const response = await apiClient.get<{ providers: ImageProviderInfo[] }>('/api/v1/assets/image-providers');
    return response.providers;
}

interface ImageProviderInfo {
    name: string;
    display_name: string;
    prompt_type: 'natural' | 'tag_based';
    supported_sizes: string[];
    supported_qualities: string[];
    supported_styles: string[];
    settings_schema: Record<string, unknown> | null;
    supports_image_input: boolean;
}

/**
 * Image Generation PostProcessor
 * Processes generation result and fetches full asset details
 */

import { fetchAsset } from '../imageService';
import type { ImageGenerationResult, ProcessedImageResult } from '../types';
import type { ImageRequestManagerConfig } from '../ImageRequestManager';

/**
 * Post-process an image generation result
 * - Fetch full asset details if generation succeeded
 * - Transform to ProcessedImageResult format
 */
export async function postProcess(
    result: ImageGenerationResult,
    config: ImageRequestManagerConfig
): Promise<ProcessedImageResult> {
    if (!result.success || !result.assetId) {
        return {
            success: false,
            error: result.error || 'Image generation failed',
        };
    }

    try {
        // Fetch full asset details
        const asset = await fetchAsset(config.projectId, result.assetId);

        return {
            success: true,
            asset: {
                id: asset.id,
                projectId: asset.project_id,
                name: asset.name,
                filePath: asset.file_path,
                thumbnailPath: asset.thumbnail_path,
                mimeType: asset.mime_type,
                generationPrompt: asset.generation_prompt,
                generationPositivePrompt: asset.generation_positive_prompt,
                generationNegativePrompt: asset.generation_negative_prompt,
                generationProvider: asset.generation_provider,
                generationModel: asset.generation_model,
                generationSettings: asset.generation_settings,
                width: asset.width,
                height: asset.height,
                fileSize: asset.file_size,
                createdAt: asset.created_at,
                updatedAt: asset.updated_at,
                fileUrl: asset.file_url,
                thumbnailUrl: asset.thumbnail_url,
            },
            revisedPrompt: result.revisedPrompt,
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to fetch asset details',
        };
    }
}

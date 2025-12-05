/**
 * Image Generation PreProcessor
 * Transforms ImageGenerationRequest into ProcessedImageRequest
 * Applies styles, validates config, prepares prompts
 */

import type {
    ImageGenerationRequest,
    ProcessedImageRequest,
    ImagePipelineContext,
} from '../types';
import { isTagBasedProvider } from '../config/providerConfig';

/**
 * Pre-process an image generation request
 * - Apply style prefixes/postfixes
 * - Transform to API-compatible format
 */
export function preProcess(
    request: ImageGenerationRequest,
    context: ImagePipelineContext
): ProcessedImageRequest {
    const isTagBased = isTagBasedProvider(request.provider);

    if (isTagBased) {
        return processTagBasedRequest(request, context);
    } else {
        return processNaturalRequest(request, context);
    }
}

/**
 * Process natural language prompts (OpenAI, Gemini, xAI)
 */
function processNaturalRequest(
    request: ImageGenerationRequest,
    context: ImagePipelineContext
): ProcessedImageRequest {
    let finalPrompt = request.prompt?.trim() || '';

    // Apply natural style if selected
    if (request.styleId && context.naturalStyles) {
        const style = context.naturalStyles.find((s) => s.id === request.styleId);
        if (style) {
            finalPrompt = `${style.prefix}${finalPrompt}${style.postfix}`;
        }
    }

    const processed: ProcessedImageRequest = {
        prompt: finalPrompt,
        provider: request.provider,
        model: request.model,
    };

    // Add size for non-Gemini providers
    if (request.provider !== 'gemini' && request.size) {
        processed.size = request.size;
    }

    // OpenAI-specific settings
    if (request.provider === 'openai') {
        if (request.quality) {
            processed.quality = request.quality;
        }
        if (request.style) {
            processed.style = request.style;
        }
    }

    // Gemini-specific settings (aspect ratio + resolution instead of size)
    if (request.provider === 'gemini') {
        processed.provider_settings = {
            aspect_ratio: request.aspectRatio || '1:1',
            image_resolution: request.resolution || '1K',
        };
    }

    // Add reference images if provided
    if (request.referenceImages && request.referenceImages.length > 0) {
        processed.reference_images = request.referenceImages.map((ref) => ({
            asset_id: ref.assetId,
            strength: ref.strength,
        }));
    }

    // Add reference objects if provided
    if (request.referenceObjects && request.referenceObjects.length > 0) {
        processed.reference_objects = request.referenceObjects.map((ref) => ({
            id: ref.id,
            type: ref.type,
            name: ref.name,
        }));
    }

    return processed;
}

/**
 * Process tag-based prompts (NovelAI)
 */
function processTagBasedRequest(
    request: ImageGenerationRequest,
    context: ImagePipelineContext
): ProcessedImageRequest {
    let finalPositive = request.positivePrompt?.trim() || '';
    let finalNegative = request.negativePrompt?.trim() || '';

    // Apply tag-based style if selected
    if (request.styleId && context.tagBasedStyles) {
        const style = context.tagBasedStyles.find((s) => s.id === request.styleId);
        if (style) {
            if (style.positiveTags) {
                finalPositive = finalPositive
                    ? `${finalPositive}, ${style.positiveTags}`
                    : style.positiveTags;
            }
            if (style.negativeTags) {
                finalNegative = finalNegative
                    ? `${finalNegative}, ${style.negativeTags}`
                    : style.negativeTags;
            }
        }
    }

    const processed: ProcessedImageRequest = {
        positive_prompt: finalPositive,
        negative_prompt: finalNegative || undefined,
        provider: request.provider,
        model: request.model,
        size: request.size,
    };

    // NovelAI-specific settings
    processed.provider_settings = {
        sampler: request.sampler || 'k_euler_ancestral',
        steps: request.steps || 28,
        scale: request.scale || 6,
        noise_schedule: request.noiseSchedule || 'native',
    };

    // Add reference objects if provided
    if (request.referenceObjects && request.referenceObjects.length > 0) {
        processed.reference_objects = request.referenceObjects.map((ref) => ({
            id: ref.id,
            type: ref.type,
            name: ref.name,
        }));
    }

    return processed;
}

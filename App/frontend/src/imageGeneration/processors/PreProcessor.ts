/**
 * Image Generation PreProcessor
 * Transforms ImageGenerationRequest into ProcessedImageRequest
 * Applies styles, validates config, prepares prompts
 */

import type {
    ImageGenerationRequest,
    ProcessedImageRequest,
    ImagePipelineContext,
    StyledPrompt,
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
    const userContent = request.prompt?.trim() || '';
    let prefix = '';
    let postfix = '';

    // Get style prefix/postfix if selected
    if (request.styleId && context.naturalStyles) {
        const style = context.naturalStyles.find((s) => s.id === request.styleId);
        if (style) {
            prefix = style.prefix || '';
            postfix = style.postfix || '';
        }
    }

    // Create StyledPrompt object
    const prompt: StyledPrompt = {
        prefix,
        content: userContent,
        postfix,
    };

    const processed: ProcessedImageRequest = {
        prompt,
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

    // Add asset type if provided
    if (request.assetType) {
        processed.asset_type = request.assetType;
    }

    // Add manuscript_id for scene asset ownership
    if (request.manuscriptId) {
        processed.manuscript_id = request.manuscriptId;
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
    const positiveContent = request.positivePrompt?.trim() || '';
    const negativeContent = request.negativePrompt?.trim() || '';

    let positivePrefix = '';
    let positivePostfix = '';
    let negativePrefix = '';
    let negativePostfix = '';

    // Get style prefix/postfix if selected
    if (request.styleId && context.tagBasedStyles) {
        const style = context.tagBasedStyles.find((s) => s.id === request.styleId);
        if (style) {
            positivePrefix = style.positivePrefix || '';
            positivePostfix = style.positivePostfix || '';
            negativePrefix = style.negativePrefix || '';
            negativePostfix = style.negativePostfix || '';
        }
    }

    // Create StyledPrompt objects
    const positive_prompt: StyledPrompt = {
        prefix: positivePrefix,
        content: positiveContent,
        postfix: positivePostfix,
    };

    const negative_prompt: StyledPrompt = {
        prefix: negativePrefix,
        content: negativeContent,
        postfix: negativePostfix,
    };

    const processed: ProcessedImageRequest = {
        positive_prompt,
        negative_prompt,
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
        // Reference image settings (i2i / Vibe Transfer)
        referenceMode: request.referenceMode || 'auto',
        strength: request.strength ?? 0.7,
        i2iNoise: request.i2iNoise ?? 0.0,
        vibeStrength: request.vibeStrength ?? 0.6,
        vibeInfoExtracted: request.vibeInfoExtracted ?? 1.0,
    };

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

    // Add asset type if provided
    if (request.assetType) {
        processed.asset_type = request.assetType;
    }

    // Add manuscript_id for scene asset ownership
    if (request.manuscriptId) {
        processed.manuscript_id = request.manuscriptId;
    }

    return processed;
}

/**
 * Image Generation Pipeline
 * Public exports
 */

// Main hook
export { useImageGeneration, type UseImageGenerationOptions } from './hooks/useImageGeneration';

// Store
export { useImageTaskStore } from './store/imageTaskStore';

// Types
export type {
    ImageProviderType,
    PromptMode,
    PromptType,
    ImageTaskStatus,
    ImageTaskType,
    ImageProviderConfig,
    ReferenceImage,
    ReferenceObject,
    ImageReferenceObject,
    ImageGenerationRequest,
    ProcessedImageRequest,
    ImageGenerationProgress,
    ImageGenerationResult,
    ProcessedImageResult,
    ImagePipelineContext,
    ImageTaskState,
    ImageRequestManagerCallbacks,
} from './types';

// Provider configuration
export {
    PROVIDER_LABELS,
    MODEL_OPTIONS,
    SIZE_OPTIONS,
    GEMINI_ASPECT_RATIOS,
    GEMINI_RESOLUTIONS,
    NOVELAI_SAMPLERS,
    NOVELAI_NOISE_SCHEDULES,
    PROVIDER_PROMPT_TYPES,
    PROVIDER_SUPPORTS_IMAGE_INPUT,
    DEFAULT_OPENAI_SETTINGS,
    DEFAULT_NOVELAI_SETTINGS,
    DEFAULT_GEMINI_SETTINGS,
    getApiKey,
    getProviderMetadata,
    isTagBasedProvider,
    getDefaultModel,
    getDefaultSize,
    type ProviderCredentials,
    type ProviderMetadata,
} from './config/providerConfig';

// Service (for advanced usage)
export { generateImage, fetchAsset, listImageProviders } from './imageService';

// Manager (for advanced usage)
export { ImageRequestManager, type ImageRequestManagerConfig } from './ImageRequestManager';

// Processors (for advanced usage)
export { preProcess } from './processors/PreProcessor';
export { postProcess } from './processors/PostProcessor';

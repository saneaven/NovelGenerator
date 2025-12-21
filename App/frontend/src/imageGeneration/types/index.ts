/**
 * Image Generation Pipeline Types
 */

// Provider types
export type ImageProviderType = 'openai' | 'gemini' | 'xai' | 'novelai';
export type PromptMode = 'natural' | 'positive' | 'negative';
export type PromptType = 'natural' | 'tag_based';

// Task tracking
export type ImageTaskStatus = 'idle' | 'preparing' | 'generating' | 'processing' | 'success' | 'error' | 'cancelled';
export type ImageTaskType = 'object-image' | 'scene-image';

// Provider configuration
export interface ImageProviderConfig {
    apiKey: string;
    baseUrl?: string;
}

/**
 * Structured prompt with style components
 */
export interface StyledPrompt {
    prefix: string;
    content: string;
    postfix: string;
}

// Reference types
export interface ReferenceImage {
    assetId: string;
    strength: number; // 0-1
}

export interface ReferenceObject {
    id: string;
    type: 'character' | 'location' | 'organization' | 'lorebook';
    name: string;
}

/**
 * Extended reference object data for image generation with full context
 */
export interface ImageReferenceObject {
    id: string;
    type: 'character' | 'location' | 'organization' | 'lorebook';
    name: string;
    description?: string;
    appearance?: string;  // For characters
    visualDescription?: string;  // For locations/orgs
    metadata?: {
        image_prompt?: string;
        image_prompt_positive?: string;
        image_prompt_negative?: string;
    };
}

// Request types
export interface ImageGenerationRequest {
    // Natural language prompt (OpenAI, Gemini, xAI)
    prompt?: string;

    // Tag-based prompts (NovelAI)
    positivePrompt?: string;
    negativePrompt?: string;

    // Provider/Model selection
    provider: ImageProviderType;
    model: string;

    // Dimensions
    size?: string; // e.g., "1024x1024"

    // OpenAI-specific
    quality?: 'standard' | 'hd';
    style?: 'natural' | 'vivid';

    // Gemini-specific (alternative to size)
    aspectRatio?: string; // e.g., "1:1", "16:9"
    resolution?: string; // e.g., "1K", "2K", "4K"

    // NovelAI-specific
    sampler?: string;
    steps?: number;
    scale?: number;
    noiseSchedule?: string;
    // NovelAI reference image settings (i2i / Vibe Transfer)
    referenceMode?: 'auto' | 'i2i' | 'vibe';
    strength?: number;        // i2i: transformation strength (0-1)
    i2iNoise?: number;        // i2i: detail addition (0-1)
    vibeStrength?: number;    // vibe: style influence (0-1)
    vibeInfoExtracted?: number; // vibe: concept extraction (0-1)

    // Style application (handled by preprocessor)
    styleId?: string | null;

    // Reference images for img2img
    referenceImages?: ReferenceImage[];

    // Story object references (for metadata)
    referenceObjects?: ReferenceObject[];

    // Asset type for categorization ('scene' for novel editor scenes, 'object' from AssetManager, 'cover' for project cover)
    assetType?: 'scene' | 'object' | 'cover';
}

// Processed request (after PreProcessor)
export interface ProcessedImageRequest {
    // Structured prompts with prefix/content/postfix
    prompt?: StyledPrompt;           // Natural language
    positive_prompt?: StyledPrompt;  // Tag-based
    negative_prompt?: StyledPrompt;  // Tag-based

    provider: string;
    model: string;
    size?: string;
    quality?: string;
    style?: string;
    provider_settings?: Record<string, unknown>;
    reference_images?: Array<{ asset_id: string; strength: number }>;
    reference_objects?: Array<{ id: string; type: string; name: string }>;
    asset_type?: 'scene' | 'object' | 'cover';
}

// Progress tracking
export interface ImageGenerationProgress {
    stage: 'preparing' | 'generating' | 'processing' | 'complete' | 'error';
    message: string;
    percentage?: number;
}

// Result types
export interface ImageGenerationResult {
    success: boolean;
    assetId?: string;
    filePath?: string;
    thumbnailPath?: string;
    revisedPrompt?: string;
    error?: string;
}

export interface ProcessedImageResult {
    success: boolean;
    asset?: {
        id: string;
        projectId: string;
        name: string;
        filePath: string;
        thumbnailPath: string | null;
        mimeType: string;
        assetType: 'scene' | 'object' | 'cover' | null;
        // Structured prompts (StyledPrompt with prefix/content/postfix)
        generationPrompt: StyledPrompt | null;
        generationPositivePrompt: StyledPrompt | null;
        generationNegativePrompt: StyledPrompt | null;
        generationProvider: string | null;
        generationModel: string | null;
        generationSettings: Record<string, unknown> | null;
        width: number | null;
        height: number | null;
        fileSize: number | null;
        createdAt: string;
        updatedAt: string;
        fileUrl: string;
        thumbnailUrl: string | null;
    };
    revisedPrompt?: string;
    error?: string;
}

// Pipeline context
export interface ImagePipelineContext {
    projectId: string;
    provider: ImageProviderType;
    providerConfig: ImageProviderConfig;
    promptMode?: PromptMode;

    // Style configuration (from settings)
    naturalStyles?: Array<{
        id: string;
        name: string;
        prefix: string;
        postfix: string;
    }>;
    tagBasedStyles?: Array<{
        id: string;
        name: string;
        positivePrefix: string;
        positivePostfix: string;
        negativePrefix: string;
        negativePostfix: string;
    }>;
    selectedNaturalStyleId?: string | null;
    selectedTagBasedStyleId?: string | null;
}

// Retry context for image generation (for notification retry support)
export interface ImageRetryContext {
    request: ImageGenerationRequest;
    projectId: string;
    provider: ImageProviderType;
    model: string;
    size?: string;
    styleId?: string | null;
}

// Task state
export interface ImageTaskState {
    id: string;
    status: ImageTaskStatus;
    taskType: ImageTaskType;
    label: string;
    progress?: {
        stage: string;
        message: string;
        percentage?: number;
    };
    error?: string;
    result?: {
        assetId?: string;
        revisedPrompt?: string;
        thumbnailUrl?: string;  // For notification preview
    };
    createdAt: number;
    updatedAt: number;
    // Notification fields
    isRead: boolean;
    retryContext?: ImageRetryContext;
}

// Callbacks
export interface ImageRequestManagerCallbacks {
    onProgress?: (progress: ImageGenerationProgress) => void;
    onComplete: (result: ProcessedImageResult) => void;
    onError: (error: Error) => void;
}

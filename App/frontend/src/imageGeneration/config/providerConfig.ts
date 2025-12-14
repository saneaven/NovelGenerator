/**
 * Centralized Image Provider Configuration
 * Single source of truth for provider-specific constants
 */

import type { ImageProviderType, PromptType } from '../types';

// Provider display names
export const PROVIDER_LABELS: Record<ImageProviderType, string> = {
    openai: 'OpenAI (DALL-E / GPT-Image)',
    gemini: 'Gemini',
    xai: 'xAI (Grok)',
    novelai: 'NovelAI',
};

// Available models per provider
export const MODEL_OPTIONS: Record<ImageProviderType, { id: string; name: string }[]> = {
    openai: [
        { id: 'gpt-image-1', name: 'GPT Image 1' },
    ],
    gemini: [
        { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview' },
        { id: 'gemini-2.0-flash-preview-image-generation', name: 'Gemini 2.0 Flash Image' },
    ],
    xai: [
        { id: 'grok-2-image', name: 'Grok 2 Image' },
        { id: 'grok-2-image-1212', name: 'Grok 2 Image 1212' },
    ],
    novelai: [
        { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full' },
        { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated' },
    ],
};

// Size options per provider
export const SIZE_OPTIONS: Record<ImageProviderType, string[]> = {
    openai: ['1024x1024', '1024x1792', '1792x1024'],
    gemini: [], // Gemini uses aspect_ratio + resolution separately
    xai: ['1024x1024', '1024x1792', '1792x1024'],
    novelai: ['1024x1024', '1216x832', '832x1216', '1472x704', '704x1472'],
};

// Gemini-specific options
export const GEMINI_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
export const GEMINI_RESOLUTIONS = ['1K', '2K', '4K'];

// NovelAI-specific options
export const NOVELAI_SAMPLERS = [
    'k_euler_ancestral',
    'k_euler',
    'k_dpmpp_2s_ancestral',
    'k_dpmpp_2m',
    'k_dpmpp_sde',
    'ddim_v3',
];

export const NOVELAI_NOISE_SCHEDULES = ['native', 'karras', 'exponential', 'polyexponential'];

// Provider prompt types
export const PROVIDER_PROMPT_TYPES: Record<ImageProviderType, PromptType> = {
    openai: 'natural',
    gemini: 'natural',
    xai: 'natural',
    novelai: 'tag_based',
};

// Provider capabilities
export const PROVIDER_SUPPORTS_IMAGE_INPUT: Record<ImageProviderType, boolean> = {
    openai: true, // GPT-Image-1
    gemini: true, // Gemini supports reference images
    xai: false,
    novelai: true, // NovelAI supports i2i and Vibe Transfer
};

// Provider-specific default settings
export const DEFAULT_OPENAI_SETTINGS = {
    quality: 'standard' as const,
    style: 'natural' as const,
};

// NovelAI reference image modes
export type NovelAIReferenceMode = 'auto' | 'i2i' | 'vibe';

export const NOVELAI_REFERENCE_MODES: { value: NovelAIReferenceMode; label: string }[] = [
    { value: 'auto', label: 'Auto (1 img = Transform, 2+ = Vibe)' },
    { value: 'i2i', label: 'Image-to-Image (transform)' },
    { value: 'vibe', label: 'Vibe Transfer (style inspiration)' },
];

export const DEFAULT_NOVELAI_SETTINGS = {
    sampler: 'k_euler_ancestral',
    steps: 28,
    scale: 6,
    noiseSchedule: 'native',
    // Reference image settings (i2i / Vibe Transfer)
    referenceMode: 'auto' as NovelAIReferenceMode,
    strength: 0.7,          // i2i: transformation strength
    i2iNoise: 0.0,          // i2i: detail addition
    vibeStrength: 0.6,      // vibe: style influence
    vibeInfoExtracted: 1.0, // vibe: concept extraction
};

export const DEFAULT_GEMINI_SETTINGS = {
    aspectRatio: '1:1',
    resolution: '1K',
};

// Credential key paths for each provider
export interface ProviderCredentials {
    openai: { apiKey: string };
    gemini: { apiKey: string };
    xai?: { apiKey: string };
    novelai?: { apiKey: string };
}

/**
 * Get API key for a provider from credentials store
 */
export function getApiKey(provider: ImageProviderType, credentials: ProviderCredentials): string {
    switch (provider) {
        case 'openai':
            return credentials.openai.apiKey;
        case 'gemini':
            return credentials.gemini.apiKey;
        case 'xai':
            return credentials.xai?.apiKey || '';
        case 'novelai':
            return credentials.novelai?.apiKey || '';
        default:
            return '';
    }
}

/**
 * Get provider metadata
 */
export interface ProviderMetadata {
    label: string;
    models: { id: string; name: string }[];
    sizes: string[];
    promptType: PromptType;
    supportsImageInput: boolean;
}

export function getProviderMetadata(provider: ImageProviderType): ProviderMetadata {
    return {
        label: PROVIDER_LABELS[provider],
        models: MODEL_OPTIONS[provider],
        sizes: SIZE_OPTIONS[provider],
        promptType: PROVIDER_PROMPT_TYPES[provider],
        supportsImageInput: PROVIDER_SUPPORTS_IMAGE_INPUT[provider],
    };
}

/**
 * Check if provider uses tag-based prompts
 */
export function isTagBasedProvider(provider: ImageProviderType): boolean {
    return PROVIDER_PROMPT_TYPES[provider] === 'tag_based';
}

/**
 * Get default model for a provider
 */
export function getDefaultModel(provider: ImageProviderType): string {
    return MODEL_OPTIONS[provider]?.[0]?.id || '';
}

/**
 * Get default size for a provider
 */
export function getDefaultSize(provider: ImageProviderType): string {
    return SIZE_OPTIONS[provider]?.[0] || '1024x1024';
}

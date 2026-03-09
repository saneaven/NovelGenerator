/**
 * Image provider UI configuration.
 * Kept minimal: only what the generation UI needs.
 */

export type ImageProviderType = 'openai' | 'gemini' | 'xai' | 'novelai';
export type PromptType = 'natural' | 'tag_based';

export const PROVIDER_LABELS: Record<ImageProviderType, string> = {
  openai: 'OpenAI Image',
  gemini: 'Gemini',
  xai: 'xAI (Grok)',
  novelai: 'NovelAI',
};

export const OPENAI_MODEL_OPTIONS = [
  { id: 'gpt-image-1.5', name: 'GPT Image 1.5' },
  { id: 'gpt-image-1', name: 'GPT Image 1' },
] as const;

export const GEMINI_MODEL_OPTIONS = [
  { id: 'gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image Preview' },
  { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview' },
] as const;

export const MODEL_OPTIONS: Record<ImageProviderType, { id: string; name: string }[]> = {
  openai: [...OPENAI_MODEL_OPTIONS],
  gemini: [...GEMINI_MODEL_OPTIONS],
  xai: [
    { id: 'grok-2-image', name: 'Grok 2 Image' },
    { id: 'grok-2-image-1212', name: 'Grok 2 Image 1212' },
  ],
  novelai: [
    { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full' },
    { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated' },
  ],
};

export const OPENAI_SIZE_OPTIONS_BY_MODEL: Record<string, string[]> = {
  'gpt-image-1.5': ['1024x1024', '1536x1024', '1024x1536'],
  'gpt-image-1': ['1024x1024', '1536x1024', '1024x1536'],
};

export const SIZE_OPTIONS: Record<ImageProviderType, string[]> = {
  openai: OPENAI_SIZE_OPTIONS_BY_MODEL['gpt-image-1.5'],
  gemini: [],
  xai: ['1024x1024', '1024x1792', '1792x1024'],
  novelai: ['1024x1024', '1216x832', '832x1216', '1472x704', '704x1472'],
};

export const GEMINI_ASPECT_RATIOS_BY_MODEL: Record<string, string[]> = {
  'gemini-3.1-flash-image-preview': ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '1:4', '4:1', '1:8', '8:1'],
  'gemini-3-pro-image-preview': ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
};

export const GEMINI_RESOLUTIONS_BY_MODEL: Record<string, string[]> = {
  'gemini-3.1-flash-image-preview': ['512px', '1K', '2K', '4K'],
  'gemini-3-pro-image-preview': ['1K', '2K', '4K'],
};

export const OPENAI_QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;
export const OPENAI_BACKGROUND_OPTIONS = ['auto', 'opaque', 'transparent'] as const;
export const OPENAI_OUTPUT_FORMAT_OPTIONS = ['png', 'jpeg', 'webp'] as const;
export const OPENAI_INPUT_FIDELITY_OPTIONS = ['low', 'high'] as const;

export const NOVELAI_SAMPLERS = [
  'k_euler_ancestral',
  'k_euler',
  'k_dpmpp_2s_ancestral',
  'k_dpmpp_2m',
  'k_dpmpp_sde',
  'ddim_v3',
];

export const NOVELAI_NOISE_SCHEDULES = ['native', 'karras', 'exponential', 'polyexponential'];

export const PROVIDER_PROMPT_TYPES: Record<ImageProviderType, PromptType> = {
  openai: 'natural',
  gemini: 'natural',
  xai: 'natural',
  novelai: 'tag_based',
};

export function getDefaultModel(provider: ImageProviderType): string {
  return MODEL_OPTIONS[provider][0]?.id ?? '';
}

export function getSizeOptions(provider: ImageProviderType, model?: string): string[] {
  if (provider === 'openai') {
    return OPENAI_SIZE_OPTIONS_BY_MODEL[model ?? 'gpt-image-1.5'] ?? OPENAI_SIZE_OPTIONS_BY_MODEL['gpt-image-1.5'];
  }
  return SIZE_OPTIONS[provider] ?? [];
}

export function getDefaultSize(provider: ImageProviderType, model?: string): string {
  return getSizeOptions(provider, model)[0] ?? '1024x1024';
}

export function getGeminiAspectRatioOptions(model?: string): string[] {
  return GEMINI_ASPECT_RATIOS_BY_MODEL[model ?? 'gemini-3.1-flash-image-preview']
    ?? GEMINI_ASPECT_RATIOS_BY_MODEL['gemini-3.1-flash-image-preview'];
}

export function getGeminiResolutionOptions(model?: string): string[] {
  return GEMINI_RESOLUTIONS_BY_MODEL[model ?? 'gemini-3.1-flash-image-preview']
    ?? GEMINI_RESOLUTIONS_BY_MODEL['gemini-3.1-flash-image-preview'];
}

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
  referenceMode: 'auto' as NovelAIReferenceMode,
  strength: 0.7,
  i2iNoise: 0.0,
  vibeStrength: 0.6,
  vibeInfoExtracted: 1.0,
};

/**
 * Image provider UI configuration.
 * Kept minimal: only what the generation UI needs.
 */

export type ImageProviderType = 'openai' | 'gemini' | 'xai' | 'novelai';
export type PromptType = 'natural' | 'tag_based';

export const PROVIDER_LABELS: Record<ImageProviderType, string> = {
  openai: 'OpenAI (DALL-E / GPT-Image)',
  gemini: 'Gemini',
  xai: 'xAI (Grok)',
  novelai: 'NovelAI',
};

export const MODEL_OPTIONS: Record<ImageProviderType, { id: string; name: string }[]> = {
  openai: [{ id: 'gpt-image-1', name: 'GPT Image 1' }],
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

export const SIZE_OPTIONS: Record<ImageProviderType, string[]> = {
  openai: ['1024x1024', '1024x1792', '1792x1024'],
  gemini: [],
  xai: ['1024x1024', '1024x1792', '1792x1024'],
  novelai: ['1024x1024', '1216x832', '832x1216', '1472x704', '704x1472'],
};

export const GEMINI_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
export const GEMINI_RESOLUTIONS = ['1K', '2K', '4K'];

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

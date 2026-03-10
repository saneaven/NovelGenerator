/**
 * Shared image provider UI configuration.
 * Static here means only provider labels and provider-specific extras.
 * Model catalogs and geometry options come from the backend.
 */

export type ImageProviderType = 'openai' | 'gemini' | 'xai' | 'novelai' | 'openrouter';
export type PromptType = 'natural' | 'tag_based';

export const IMAGE_PROVIDER_ORDER: ImageProviderType[] = ['openai', 'gemini', 'xai', 'novelai', 'openrouter'];

export const PROVIDER_LABELS: Record<ImageProviderType, string> = {
  openai: 'OpenAI Image',
  gemini: 'Gemini Image',
  xai: 'xAI (Grok Image)',
  novelai: 'NovelAI',
  openrouter: 'OpenRouter Image',
};

export const PROVIDER_PROMPT_TYPES: Record<ImageProviderType, PromptType> = {
  openai: 'natural',
  gemini: 'natural',
  xai: 'natural',
  novelai: 'tag_based',
  openrouter: 'natural',
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

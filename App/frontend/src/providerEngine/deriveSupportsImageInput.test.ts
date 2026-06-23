import { describe, expect, it } from 'vitest';

import { deriveSupportsImageInput } from './utils';

describe('deriveSupportsImageInput', () => {
  it('reads architecture.input_modalities (OpenRouter / NanoGPT)', () => {
    expect(deriveSupportsImageInput({ architecture: { input_modalities: ['text', 'image'] } })).toBe(true);
    expect(deriveSupportsImageInput({ architecture: { input_modalities: ['text'] } })).toBe(false);
  });

  it('reads top-level input_modalities (xAI language-models)', () => {
    expect(deriveSupportsImageInput({ input_modalities: ['text', 'image'] })).toBe(true);
    expect(deriveSupportsImageInput({ input_modalities: ['text'] })).toBe(false);
  });

  it('reads capabilities.image_input.supported (Anthropic)', () => {
    expect(deriveSupportsImageInput({ capabilities: { image_input: { supported: true } } })).toBe(true);
    expect(deriveSupportsImageInput({ capabilities: { image_input: { supported: false } } })).toBe(false);
  });

  it('reads capabilities array for vision (Ollama)', () => {
    expect(deriveSupportsImageInput({ capabilities: ['completion', 'vision', 'tools'] })).toBe(true);
    expect(deriveSupportsImageInput({ capabilities: ['completion', 'tools'] })).toBe(false);
  });

  it('returns null when the provider exposes no modality info (OpenAI / Gemini)', () => {
    expect(deriveSupportsImageInput({ id: 'gpt-4o', owned_by: 'openai' })).toBeNull();
    expect(deriveSupportsImageInput({ id: 'gemini-2.0-flash' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(deriveSupportsImageInput(null)).toBeNull();
    expect(deriveSupportsImageInput('gpt-4o')).toBeNull();
  });
});

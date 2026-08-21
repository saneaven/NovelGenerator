import { describe, expect, it } from 'vitest';
import type { Asset, ImageRun } from '../api/assetService';
import { recipeFromAsset } from './fromAsset';
import { generationRecipeFromImageRun } from './helpers';

const characters = [
  { positive: 'girl, red hair, raincoat', negative: 'hat' },
  { positive: 'boy, black hair, sailor uniform', negative: '' },
];

describe('NovelAI image recipe restoration', () => {
  it('preserves ordered character prompt pairs from asset metadata', () => {
    const asset = {
      generation_prompt_format: 'novelai',
      generation_prompt_data: {
        positive: { prefix: 'style, ', content: '2people, harbor', postfix: ', cinematic' },
        negative: { prefix: '', content: 'lowres', postfix: '' },
        characters,
      },
      generation_provider: 'novelai',
      generation_model: 'nai-diffusion-5-full',
      generation_style_id: 'style-1',
      generation_requested_aspect_ratio: '13:19',
      generation_requested_image_size: '832x1216',
      generation_settings: { sampler: 'k_euler_ancestral' },
      generation_reference_images: null,
      generation_mask_image: null,
    } as unknown as Asset;

    const recipe = recipeFromAsset(asset);

    expect(recipe?.promptFormat).toBe('novelai');
    if (!recipe || recipe.promptFormat !== 'novelai') throw new Error('Expected NovelAI recipe');
    expect(recipe.promptData.characters).toEqual(characters);
  });

  it('preserves ordered character prompt pairs from an image-run snapshot', () => {
    const run = {
      request_snapshot: {
        recipe: {
          prompt_format: 'novelai',
          prompt_data: {
            positive: { prefix: '', content: '2people, harbor', postfix: '' },
            negative: { prefix: '', content: 'lowres', postfix: '' },
            characters,
          },
          provider: 'novelai',
          model: 'nai-diffusion-5-full',
          requested_aspect_ratio: '13:19',
          requested_image_size: '832x1216',
          style_id: null,
          provider_settings: {},
          reference_images: null,
          mask_image: null,
        },
      },
    } as unknown as ImageRun;

    const recipe = generationRecipeFromImageRun(run);

    expect(recipe?.promptFormat).toBe('novelai');
    if (!recipe || recipe.promptFormat !== 'novelai') throw new Error('Expected NovelAI recipe');
    expect(recipe.promptData.characters).toEqual(characters);
  });
});

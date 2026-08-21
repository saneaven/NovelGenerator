import { describe, expect, it } from 'vitest';

import type { ImageModelInfo } from '../../api/assetService';
import { reconcileSelectionWithModel, resolveCatalogSelection } from './selection';

const models = [
  { id: 'nai-diffusion-5-curated' },
  { id: 'nai-diffusion-5-full' },
] as ImageModelInfo[];

describe('image model selection', () => {
  it('keeps a cleared model input empty', () => {
    const selected = resolveCatalogSelection(models, '');

    expect(selected).toBeNull();
    expect(reconcileSelectionWithModel(selected, {
      model: '',
      aspectRatio: '13:19',
      imageSize: '832x1216',
    }).model).toBe('');
  });

  it('does not replace an in-progress search with the first model', () => {
    expect(resolveCatalogSelection(models, 'nai-diffusion-5-f')).toBeNull();
  });

  it('selects an exact catalog model', () => {
    expect(resolveCatalogSelection(models, 'nai-diffusion-5-full')?.id)
      .toBe('nai-diffusion-5-full');
  });
});

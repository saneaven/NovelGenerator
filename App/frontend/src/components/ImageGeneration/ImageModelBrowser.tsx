import React, { useMemo, useState } from 'react';
import type { ImageModelInfo } from '../../api/assetService';
import type { ImageProviderType } from '../../store/settingsStore';
import { TextButton } from '../TextButton';
import { Check, Close } from '../icons';
import { useTranslation } from 'react-i18next';
import './ImageModelBrowser.css';

type ImageModelBrowserProps = {
  provider: ImageProviderType;
  models: ImageModelInfo[];
  currentModel: string;
  onSelectModel: (modelId: string) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
};

function formatGeometry(model: ImageModelInfo): string {
  if (model.ui_resolution_mode === 'native_exact') {
    const sizes = model.supported_image_sizes.slice(0, 3).join(', ');
    const extra = model.supported_image_sizes.length > 3 ? `, +${model.supported_image_sizes.length - 3}` : '';
    return `Output sizes: ${sizes}${extra}`;
  }
  const ratios = model.supported_aspect_ratios.slice(0, 3).join(', ');
  const sizes = model.supported_image_sizes.slice(0, 3).join(', ');
  const ratioExtra = model.supported_aspect_ratios.length > 3 ? `, +${model.supported_aspect_ratios.length - 3}` : '';
  const sizeExtra = model.supported_image_sizes.length > 3 ? `, +${model.supported_image_sizes.length - 3}` : '';
  return `Ratios: ${ratios}${ratioExtra} / Sizes: ${sizes}${sizeExtra}`;
}

function formatPricing(model: ImageModelInfo): string | null {
  const pricing = model.pricing;
  if (!pricing) return null;
  if (typeof pricing.image === 'string' && pricing.image.trim()) return pricing.image;
  const providerPricing = pricing as Record<string, unknown>;
  const perImage = providerPricing.per_image;
  if (typeof perImage === 'string' && perImage.trim()) return perImage;
  return null;
}

function getBadges(model: ImageModelInfo): string[] {
  const badges: string[] = [];
  if (model.supports_image_input) badges.push('Image Input');
  if (model.supports_multi_image_input) badges.push('Multi Image');
  if (model.supports_mask_input) badges.push('Mask');
  if (model.category && model.category.toLowerCase() !== 'other') badges.push(model.category);
  return badges;
}

const ImageModelBrowser: React.FC<ImageModelBrowserProps> = ({
  models,
  currentModel,
  onSelectModel,
  loading = false,
  error = null,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const [showBrowser, setShowBrowser] = useState(false);

  // The model-name input doubles as the search field.
  const filteredModels = useMemo(() => {
    const needle = currentModel.trim().toLowerCase();
    if (!needle) return models;
    return models.filter((model) => {
      return model.name.toLowerCase().includes(needle)
        || model.id.toLowerCase().includes(needle)
        || String(model.description || '').toLowerCase().includes(needle)
        || String(model.category || '').toLowerCase().includes(needle);
    });
  }, [models, currentModel]);

  return (
    <div className="image-model-browser">
      <div className="model-input-row">
        <div className="model-input-control">
          <input
            type="text"
            value={currentModel}
            onChange={(event) => onSelectModel(event.target.value)}
            placeholder={loading ? 'Loading models...' : 'Search or enter a model'}
            className="config-input"
            disabled={disabled}
          />
          {currentModel && !disabled ? (
            <button
              type="button"
              className="model-input-clear"
              onClick={() => onSelectModel('')}
              aria-label={t('common.clear')}
            >
              <Close size="xs" />
            </button>
          ) : null}
        </div>
        <TextButton
          variant={showBrowser ? 'primary' : 'secondary'}
          size="sm"
          type="button"
          onClick={() => setShowBrowser((prev) => !prev)}
          disabled={disabled || loading}
        >
          {showBrowser ? 'Hide' : 'Browse'}
        </TextButton>
      </div>

      {showBrowser ? (
        <div className="image-model-browser__panel">
          {error ? <div className="image-model-browser__empty">{error}</div> : null}
          {!error && filteredModels.length === 0 ? (
            <div className="image-model-browser__empty">
              {loading ? 'Loading models...' : 'No models found.'}
            </div>
          ) : null}
          {!error ? (
            <div className="image-model-browser__list">
              {filteredModels.map((model) => {
                const isSelected = model.id === currentModel;
                return (
                  <button
                    key={model.id}
                    type="button"
                    className={`image-model-browser__item ${isSelected ? 'selected' : ''}`}
                    onClick={() => {
                      onSelectModel(model.id);
                      setShowBrowser(false);
                    }}
                  >
                    <div className="image-model-browser__item-main">
                      <div className="image-model-browser__item-header">
                        <strong>{model.name}</strong>
                        {isSelected ? <Check size="sm" /> : null}
                      </div>
                      <div className="image-model-browser__item-id">{model.id}</div>
                      {model.description ? (
                        <div className="image-model-browser__item-description">{model.description}</div>
                      ) : null}
                      <div className="image-model-browser__item-meta">{formatGeometry(model)}</div>
                      {getBadges(model).length > 0 ? (
                        <div className="image-model-browser__item-badges">
                          {getBadges(model).map((badge) => <span key={badge}>{badge}</span>)}
                        </div>
                      ) : null}
                      {formatPricing(model) ? (
                        <div className="image-model-browser__item-pricing">{formatPricing(model)}</div>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default ImageModelBrowser;

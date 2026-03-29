import React from 'react';
import type { ImageModelInfo } from '../../api/assetService';
import type { ImageProviderType } from '../../store/settingsStore';
import { CustomSelect } from '../ui/CustomSelect';
import { Check } from '../icons';

type ImageModelBrowserProps = {
  provider: ImageProviderType;
  models: ImageModelInfo[];
  currentModel: string;
  onSelectModel: (modelId: string) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
};

function buildDescription(provider: ImageProviderType, model: ImageModelInfo): string | undefined {
  if (provider !== 'openrouter') return model.description ?? undefined;

  const parts: string[] = [];
  if (model.pricing?.image) parts.push(`Image ${model.pricing.image}`);
  if (model.supports_image_input) parts.push('Image input');
  const outputs = model.architecture?.output_modalities?.join(', ');
  if (outputs) parts.push(`Out: ${outputs}`);
  return [model.description, parts.join(' • ')].filter(Boolean).join(' — ') || undefined;
}

const ImageModelBrowser: React.FC<ImageModelBrowserProps> = ({
  provider,
  models,
  currentModel,
  onSelectModel,
  loading = false,
  error = null,
  disabled = false,
}) => {
  const placeholder = loading
    ? 'Loading models...'
    : error
      ? 'Failed to load models'
      : models.length === 0
        ? 'No models available'
        : 'Select model';

  return (
    <CustomSelect
      value={currentModel}
      onChange={onSelectModel}
      disabled={disabled || loading || models.length === 0}
      placeholder={placeholder}
      options={models.map((model) => ({
        value: model.id,
        label: model.name,
        description: buildDescription(provider, model),
      }))}
      renderOption={({ option, isSelected, onSelect }) => (
        <button
          type="button"
          className={`custom-select-option ${isSelected ? 'selected' : ''}`}
          onClick={onSelect}
        >
          <div className="custom-select-option-content">
            <span className="custom-select-option-text">{option.label}</span>
            {option.description ? (
              <span className="custom-select-option-description">{option.description}</span>
            ) : (
              <span className="custom-select-option-description">{option.value}</span>
            )}
          </div>
          {isSelected ? (
            <span className="custom-select-check">
              <Check size="sm" />
            </span>
          ) : null}
        </button>
      )}
    />
  );
};

export default ImageModelBrowser;

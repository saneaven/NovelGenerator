import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageGenConfig, ImageProviderType } from '../../domain/settings';
import {
  applyAspectRatioChange,
  applyImageSizeChange,
} from '../../imageRun/form/selection';
import { useImageGenerationForm } from '../../imageRun/form/useImageGenerationForm';
import { buildImageProviderSettingsDraft } from '../../imageRun/form/providerSettings';
import { getStoredProviderSettings, setStoredProviderSettings } from '../../providerEngine/utils';
import { CustomSelect } from '../ui/CustomSelect';
import ImageModelBrowser from '../ImageGeneration/ImageModelBrowser';
import ImageStyleEditorModal from './ImageStyleEditorModal';
import ProviderSettingsFields from '../../providerEngine/ProviderSettingsFields';
import './ImageGenPanel.css';

interface ImageGenPanelProps {
  config: ImageGenConfig;
  onChange: (config: ImageGenConfig) => void;
}

const ImageGenPanel: React.FC<ImageGenPanelProps> = ({ config, onChange }) => {
  const { t } = useTranslation();
  const {
    providerSpecs: specs,
    providerSpec,
    imageProviders,
    models,
    loading,
    error: modelError,
    selectedModel,
    currentPromptFormat,
    providerSettingsSpec,
    providerSettingsFlags,
    isNativeExact,
    supportedImageSizes: supportedSizes,
    reconciledSelection,
  } = useImageGenerationForm({
    provider: config.provider,
    model: config.model,
    aspectRatio: config.aspect_ratio,
    imageSize: config.image_size,
    providerSettingsDraft: getStoredProviderSettings(config as Record<string, unknown>, config.provider),
  });

  useEffect(() => {
    if (
      reconciledSelection.model === config.model
      && reconciledSelection.aspectRatio === config.aspect_ratio
      && reconciledSelection.imageSize === config.image_size
    ) {
      return;
    }
    onChange({
      ...config,
      model: reconciledSelection.model,
      aspect_ratio: reconciledSelection.aspectRatio,
      image_size: reconciledSelection.imageSize,
    });
  }, [config, onChange, reconciledSelection]);

  const providerOptions = imageProviders.map((provider) => ({
    value: provider.id,
    label: t(provider.ui.display_name_key),
  }));

  const currentStyles = currentPromptFormat === 'natural'
    ? config.naturalStyles
    : currentPromptFormat === 'positive_negative'
      ? config.positiveNegativeStyles
      : config.novelAIStyles;
  const selectedStyleId = currentPromptFormat === 'natural'
    ? config.selectedNaturalStyleId
    : currentPromptFormat === 'positive_negative'
      ? config.selectedPositiveNegativeStyleId
      : config.selectedNovelAIStyleId;
  const styleKey = `settings.imageGen.${
    currentPromptFormat === 'natural'
      ? 'naturalStyles'
      : currentPromptFormat === 'positive_negative'
        ? 'positiveNegativeStyles'
        : 'novelAIStyles'
  }`;
  const providerSettings = getStoredProviderSettings(config as Record<string, unknown>, config.provider);

  return (
    <div className="image-gen-panel">
      <div className="panel-header">
        <h3>{t('settings.imageGen.title')}</h3>
        <p className="panel-description">{t('settings.imageGen.description')}</p>
      </div>

      <div className="settings-grid image-settings-grid">
        <div className="setting-item setting-item--full">
          <label className="setting-label">
            <span className="label-text">{t('settings.imageGen.provider')}</span>
            <span className="label-hint">{t('settings.imageGen.providerHint')}</span>
          </label>
          <CustomSelect
            value={config.provider}
            onChange={(value) => {
              const nextSettings = buildImageProviderSettingsDraft(
                value,
                specs,
                config as Record<string, unknown>,
              );
              const nextConfig = setStoredProviderSettings(
                { ...config, provider: value as ImageProviderType, model: '' } as Record<string, unknown>,
                value,
                nextSettings
              ) as ImageGenConfig;
              onChange(nextConfig);
            }}
            options={providerOptions}
          />
        </div>

        <div className="setting-item setting-item--full">
          <label className="setting-label">
            <span className="label-text">{t('settings.imageGen.model')}</span>
            <span className="label-hint">{t('settings.imageGen.modelHint')}</span>
          </label>
          <ImageModelBrowser
            provider={config.provider}
            models={models}
            currentModel={config.model}
            onSelectModel={(model) => onChange({ ...config, model })}
            loading={loading}
            error={modelError}
          />
        </div>

        {!isNativeExact ? (
          <>
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.aspectRatio')}</span>
                <span className="label-hint">{t('settings.imageGen.aspectRatioHint')}</span>
              </label>
              <CustomSelect
                value={config.aspect_ratio}
                onChange={(value) => {
                  const nextSelection = applyAspectRatioChange(
                    selectedModel,
                    {
                      model: config.model,
                      aspectRatio: config.aspect_ratio,
                      imageSize: config.image_size,
                    },
                    value,
                  );
                  onChange({
                    ...config,
                    aspect_ratio: nextSelection.aspectRatio,
                    image_size: nextSelection.imageSize,
                  });
                }}
                disabled={!selectedModel || selectedModel.supported_aspect_ratios.length <= 1}
                options={(selectedModel?.supported_aspect_ratios ?? [config.aspect_ratio]).map((ratio) => ({
                  value: ratio,
                  label: ratio,
                }))}
              />
            </div>

            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.resolution')}</span>
                <span className="label-hint">{t('settings.imageGen.resolutionHint')}</span>
              </label>
              <CustomSelect
                value={config.image_size}
                onChange={(value) => {
                  const nextSelection = applyImageSizeChange(
                    selectedModel,
                    {
                      model: config.model,
                      aspectRatio: config.aspect_ratio,
                      imageSize: config.image_size,
                    },
                    value,
                  );
                  onChange({
                    ...config,
                    aspect_ratio: nextSelection.aspectRatio,
                    image_size: nextSelection.imageSize,
                  });
                }}
                disabled={!selectedModel || supportedSizes.length <= 1}
                options={(supportedSizes.length > 0 ? supportedSizes : [config.image_size]).map((size) => ({
                  value: size,
                  label: size,
                }))}
              />
            </div>
          </>
        ) : (
          <>
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">Output Size</span>
                <span className="label-hint">Choose one of the model&apos;s native output sizes.</span>
              </label>
              <CustomSelect
                value={config.image_size}
                onChange={(value) => {
                  const nextSelection = applyImageSizeChange(
                    selectedModel,
                    {
                      model: config.model,
                      aspectRatio: config.aspect_ratio,
                      imageSize: config.image_size,
                    },
                    value,
                  );
                  onChange({
                    ...config,
                    image_size: nextSelection.imageSize,
                    aspect_ratio: nextSelection.aspectRatio,
                  });
                }}
                disabled={!selectedModel || selectedModel.supported_image_sizes.length <= 1}
                options={(selectedModel?.supported_image_sizes ?? [config.image_size]).map((size) => ({
                  value: size,
                  label: size,
                }))}
              />
            </div>

            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.aspectRatio')}</span>
                <span className="label-hint">Derived from the selected output size.</span>
              </label>
              <input type="text" className="config-input" value={config.aspect_ratio} disabled />
            </div>
          </>
        )}
      </div>

      {providerSettingsSpec ? (
        <div className="provider-settings-section">
          <div className="section-header">
            <h4>{t(providerSpec?.image?.settings_title_key || providerSpec?.ui.display_name_key || 'settings.imageGen.provider')}</h4>
            {providerSpec?.image?.settings_description_key ? (
              <p className="section-description">{t(providerSpec.image.settings_description_key)}</p>
            ) : null}
          </div>
          <ProviderSettingsFields
            spec={providerSettingsSpec}
            draft={providerSettings}
            setDraft={(next) => {
              const resolved =
                typeof next === 'function'
                  ? next(providerSettings)
                  : next;
              onChange(setStoredProviderSettings(config as Record<string, unknown>, config.provider, resolved) as ImageGenConfig);
            }}
            flags={providerSettingsFlags}
          />
        </div>
      ) : null}

      <div className="custom-styles-section">
        <div className="section-header">
          <h4>{t(`${styleKey}.title`)}</h4>
          <p className="section-description">
            {t(`${styleKey}.description`)}
          </p>
        </div>
        <div className="setting-item">
          <label className="setting-label">
            <span className="label-text">{t(`${styleKey}.defaultStyle`)}</span>
            <span className="label-hint">{t(`${styleKey}.defaultStyleHint`)}</span>
          </label>
          <CustomSelect
            value={selectedStyleId ?? ''}
            onChange={(value) => onChange({
              ...config,
              ...(currentPromptFormat === 'natural'
                ? { selectedNaturalStyleId: value || null }
                : currentPromptFormat === 'positive_negative'
                  ? { selectedPositiveNegativeStyleId: value || null }
                  : { selectedNovelAIStyleId: value || null }),
            })}
            options={[
              { value: '', label: t(`${styleKey}.none`) },
              ...currentStyles.map((style) => ({
                value: style.id,
                label: style.name,
              })),
            ]}
          />
          <div className="style-editor-meta">
            <h5 className="style-editor-meta-title">{t('settings.imageGen.styleEditor.title')}</h5>
            <p className="style-editor-meta-description">{t('settings.imageGen.styleEditor.subtitle')}</p>
          </div>
          {currentPromptFormat === 'natural' ? (
            <ImageStyleEditorModal
              mode="natural"
              styles={config.naturalStyles}
              onChange={(styles) => onChange({ ...config, naturalStyles: styles })}
            />
          ) : currentPromptFormat === 'positive_negative' ? (
            <ImageStyleEditorModal
              mode="positive_negative"
              styles={config.positiveNegativeStyles}
              onChange={(styles) => onChange({ ...config, positiveNegativeStyles: styles })}
            />
          ) : (
            <ImageStyleEditorModal
              mode="novelai"
              styles={config.novelAIStyles}
              onChange={(styles) => onChange({ ...config, novelAIStyles: styles })}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageGenPanel;

import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageGenConfig, ImageProviderType } from '../../store/settingsStore';
import {
  resolveAspectRatio,
  resolveImageSize,
  resolveSupportedImageSizes,
  aspectRatioFromImageSize,
  useImageModelCatalog,
} from '../../imageRun/useImageModelCatalog';
import { useProviderSpecStore } from '../../providerEngine/store';
import {
  buildDefaultObjectValue,
  getStoredProviderSettings,
  setStoredProviderSettings,
} from '../../providerEngine/utils';
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
  const specs = useProviderSpecStore((state) => state.specs);
  const loadProviderSpecs = useProviderSpecStore((state) => state.load);
  const providerSpec = specs[config.provider];
  const { models, loading, error: modelError, selectedModel } = useImageModelCatalog(config.provider, config.model);

  useEffect(() => {
    void loadProviderSpecs();
  }, [loadProviderSpecs]);

  const imageProviders = useMemo(() => {
    const providers = Object.values(specs).filter((provider) => Boolean(provider.image));
    providers.sort((a, b) => {
      const left = a.ui.image_order ?? 999;
      const right = b.ui.image_order ?? 999;
      return left - right || a.id.localeCompare(b.id);
    });
    return providers;
  }, [specs]);

  useEffect(() => {
    if (!selectedModel) return;
    const nextModel = selectedModel.id;
    let nextAspectRatio = config.aspect_ratio;
    let nextImageSize = config.image_size;

    if (selectedModel.ui_resolution_mode === 'native_exact') {
      nextImageSize = resolveImageSize(selectedModel, config.image_size);
      nextAspectRatio = aspectRatioFromImageSize(nextImageSize);
    } else {
      nextAspectRatio = resolveAspectRatio(selectedModel, config.aspect_ratio);
      const supportedSizes = resolveSupportedImageSizes(selectedModel, nextAspectRatio);
      nextImageSize = supportedSizes.includes(config.image_size)
        ? config.image_size
        : (supportedSizes[0] ?? resolveImageSize(selectedModel, config.image_size));
    }

    if (
      nextModel === config.model
      && nextAspectRatio === config.aspect_ratio
      && nextImageSize === config.image_size
    ) {
      return;
    }
    onChange({
      ...config,
      model: nextModel,
      aspect_ratio: nextAspectRatio,
      image_size: nextImageSize,
    });
  }, [config, onChange, selectedModel]);

  const providerOptions = imageProviders.map((provider) => ({
    value: provider.id,
    label: t(provider.ui.display_name_key),
  }));

  const currentPromptType = selectedModel?.prompt_type ?? providerSpec?.image?.prompt_type ?? 'natural';
  const isTagBased = currentPromptType === 'tag_based';
  const currentStyles = isTagBased ? config.tagBasedStyles : config.naturalStyles;
  const selectedStyleId = isTagBased ? config.selectedTagBasedStyleId : config.selectedNaturalStyleId;
  const styleKey = isTagBased ? 'settings.imageGen.tagBasedStyles' : 'settings.imageGen.naturalStyles';
  const providerSettingsSpec = providerSpec?.image?.provider_settings ?? null;
  const providerSettings = getStoredProviderSettings(config as Record<string, unknown>, config.provider);
  const isNativeExact = selectedModel?.ui_resolution_mode === 'native_exact';
  const supportedSizes = resolveSupportedImageSizes(selectedModel, config.aspect_ratio);
  const providerSettingsFlags = useMemo(() => ({
    kontext_model: /kontext/i.test(selectedModel?.id ?? config.model),
  }), [selectedModel, config.model]);

  return (
    <div className="image-gen-panel">
      <div className="panel-header">
        <h3>{t('settings.imageGen.title')}</h3>
        <p className="panel-description">{t('settings.imageGen.description')}</p>
      </div>

      <div className="settings-grid">
        <div className="setting-item">
          <label className="setting-label">
            <span className="label-text">{t('settings.imageGen.provider')}</span>
            <span className="label-hint">{t('settings.imageGen.providerHint')}</span>
          </label>
          <CustomSelect
            value={config.provider}
            onChange={(value) => {
              const nextProviderSpec = imageProviders.find((provider) => provider.id === value);
              const existingSettings = getStoredProviderSettings(config as Record<string, unknown>, value);
              const nextSettings = Object.keys(existingSettings).length > 0
                ? existingSettings
                : (value === 'nanogpt' ? {} : buildDefaultObjectValue(nextProviderSpec?.image?.provider_settings));
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

        <div className="setting-item">
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
                  const nextSizes = resolveSupportedImageSizes(selectedModel, value);
                  onChange({
                    ...config,
                    aspect_ratio: value,
                    image_size: nextSizes.includes(config.image_size)
                      ? config.image_size
                      : (nextSizes[0] ?? config.image_size),
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
                onChange={(value) => onChange({ ...config, image_size: value })}
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
                onChange={(value) => onChange({
                  ...config,
                  image_size: value,
                  aspect_ratio: aspectRatioFromImageSize(value),
                })}
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
              selectedNaturalStyleId: isTagBased ? config.selectedNaturalStyleId : (value || null),
              selectedTagBasedStyleId: isTagBased ? (value || null) : config.selectedTagBasedStyleId,
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
          {isTagBased ? (
            <ImageStyleEditorModal
              mode="tag_based"
              styles={config.tagBasedStyles}
              onChange={(styles) => onChange({ ...config, tagBasedStyles: styles })}
            />
          ) : null}
          {!isTagBased ? (
            <ImageStyleEditorModal
              mode="natural"
              styles={config.naturalStyles}
              onChange={(styles) => onChange({ ...config, naturalStyles: styles })}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default ImageGenPanel;

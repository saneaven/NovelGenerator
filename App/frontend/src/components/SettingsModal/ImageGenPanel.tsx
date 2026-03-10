import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ImageGenConfig, ImageProviderType } from '../../store/settingsStore';
import {
  IMAGE_PROVIDER_ORDER,
  NOVELAI_NOISE_SCHEDULES,
  NOVELAI_SAMPLERS,
  OPENAI_BACKGROUND_OPTIONS,
  OPENAI_INPUT_FIDELITY_OPTIONS,
  OPENAI_OUTPUT_FORMAT_OPTIONS,
  OPENAI_QUALITY_OPTIONS,
  PROVIDER_LABELS,
  PROVIDER_PROMPT_TYPES,
} from '../../imageRun/providerConfig';
import {
  resolveAspectRatio,
  resolveImageSize,
  useImageModelCatalog,
} from '../../imageRun/useImageModelCatalog';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import { NumberInput } from '../ui/NumberInput';
import ImageModelBrowser from '../ImageGeneration/ImageModelBrowser';
import ImageStyleEditorModal from './ImageStyleEditorModal';
import './ImageGenPanel.css';

interface ImageGenPanelProps {
  config: ImageGenConfig;
  onChange: (config: ImageGenConfig) => void;
}

const ImageGenPanel: React.FC<ImageGenPanelProps> = ({ config, onChange }) => {
  const { t } = useTranslation();
  const [showStyleModal, setShowStyleModal] = useState(false);
  const { models, loading, selectedModel } = useImageModelCatalog(config.provider, config.model);

  useEffect(() => {
    if (!selectedModel) return;
    const nextModel = selectedModel.id;
    const nextAspectRatio = resolveAspectRatio(selectedModel, config.aspect_ratio);
    const nextImageSize = resolveImageSize(selectedModel, config.image_size);
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

  const currentPromptType = selectedModel?.prompt_type ?? PROVIDER_PROMPT_TYPES[config.provider];
  const isTagBased = currentPromptType === 'tag_based';
  const isNovelAI = config.provider === 'novelai';
  const isOpenAI = config.provider === 'openai';
  const compressionEnabled = config.openaiSettings.output_format !== 'png';
  const currentStyles = isTagBased ? config.tagBasedStyles : config.naturalStyles;
  const selectedStyleId = isTagBased ? config.selectedTagBasedStyleId : config.selectedNaturalStyleId;
  const styleKey = isTagBased ? 'settings.imageGen.tagBasedStyles' : 'settings.imageGen.naturalStyles';

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
            onChange={(value) => onChange({ ...config, provider: value as ImageProviderType, model: '' })}
            options={IMAGE_PROVIDER_ORDER.map((provider) => ({
              value: provider,
              label: PROVIDER_LABELS[provider],
            }))}
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
          />
        </div>

        <div className="setting-item">
          <label className="setting-label">
            <span className="label-text">{t('settings.imageGen.aspectRatio')}</span>
            <span className="label-hint">{t('settings.imageGen.aspectRatioHint')}</span>
          </label>
          <CustomSelect
            value={config.aspect_ratio}
            onChange={(value) => onChange({ ...config, aspect_ratio: value })}
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
            disabled={!selectedModel || selectedModel.supported_image_sizes.length <= 1}
            options={(selectedModel?.supported_image_sizes ?? [config.image_size]).map((size) => ({
              value: size,
              label: size,
            }))}
          />
        </div>
      </div>

      {isOpenAI && (
        <div className="provider-settings-section">
          <div className="section-header">
            <h4>{t('settings.imageGen.openaiSettings.title')}</h4>
            <p className="section-description">{t('settings.imageGen.openaiSettings.description')}</p>
          </div>
          <div className="settings-grid">
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.openaiSettings.quality')}</span>
                <span className="label-hint">{t('settings.imageGen.openaiSettings.qualityHint')}</span>
              </label>
              <CustomSelect
                value={config.openaiSettings.quality}
                onChange={(value) => onChange({
                  ...config,
                  openaiSettings: { ...config.openaiSettings, quality: value as 'auto' | 'low' | 'medium' | 'high' },
                })}
                options={OPENAI_QUALITY_OPTIONS.map((value) => ({
                  value,
                  label: t(`settings.imageGen.openaiSettings.qualityOptions.${value}`),
                }))}
              />
            </div>
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.openaiSettings.background')}</span>
                <span className="label-hint">{t('settings.imageGen.openaiSettings.backgroundHint')}</span>
              </label>
              <CustomSelect
                value={config.openaiSettings.background}
                onChange={(value) => onChange({
                  ...config,
                  openaiSettings: { ...config.openaiSettings, background: value as 'auto' | 'opaque' | 'transparent' },
                })}
                options={OPENAI_BACKGROUND_OPTIONS.map((value) => ({
                  value,
                  label: t(`settings.imageGen.openaiSettings.backgroundOptions.${value}`),
                }))}
              />
            </div>
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.openaiSettings.format')}</span>
                <span className="label-hint">{t('settings.imageGen.openaiSettings.formatHint')}</span>
              </label>
              <CustomSelect
                value={config.openaiSettings.output_format}
                onChange={(value) => onChange({
                  ...config,
                  openaiSettings: { ...config.openaiSettings, output_format: value as 'png' | 'jpeg' | 'webp' },
                })}
                options={OPENAI_OUTPUT_FORMAT_OPTIONS.map((value) => ({
                  value,
                  label: t(`settings.imageGen.openaiSettings.formatOptions.${value}`),
                }))}
              />
            </div>
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.openaiSettings.compression')}</span>
                <span className="label-hint">{t('settings.imageGen.openaiSettings.compressionHint')}</span>
              </label>
              <NumberInput
                min={0}
                max={100}
                value={config.openaiSettings.output_compression}
                onValueChange={(value) => onChange({
                  ...config,
                  openaiSettings: { ...config.openaiSettings, output_compression: value ?? 90 },
                })}
                className="setting-input"
                disabled={!compressionEnabled}
              />
            </div>
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.openaiSettings.inputFidelity')}</span>
                <span className="label-hint">{t('settings.imageGen.openaiSettings.inputFidelityHint')}</span>
              </label>
              <CustomSelect
                value={config.openaiSettings.input_fidelity}
                onChange={(value) => onChange({
                  ...config,
                  openaiSettings: { ...config.openaiSettings, input_fidelity: value as 'low' | 'high' },
                })}
                options={OPENAI_INPUT_FIDELITY_OPTIONS.map((value) => ({
                  value,
                  label: t(`settings.imageGen.openaiSettings.inputFidelityOptions.${value}`),
                }))}
              />
            </div>
          </div>
        </div>
      )}

      {isNovelAI && (
        <div className="provider-settings-section">
          <div className="section-header">
            <h4>{t('settings.imageGen.novelaiSettings.title')}</h4>
            <p className="section-description">{t('settings.imageGen.novelaiSettings.description')}</p>
          </div>
          <div className="settings-grid novelai-settings">
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.novelaiSettings.sampler')}</span>
                <span className="label-hint">{t('settings.imageGen.novelaiSettings.samplerHint')}</span>
              </label>
              <CustomSelect
                value={config.novelaiSettings.sampler}
                onChange={(value) => onChange({
                  ...config,
                  novelaiSettings: { ...config.novelaiSettings, sampler: value },
                })}
                options={NOVELAI_SAMPLERS.map((value) => ({ value, label: value }))}
              />
            </div>
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.novelaiSettings.steps')}</span>
                <span className="label-hint">{t('settings.imageGen.novelaiSettings.stepsHint')}</span>
              </label>
              <NumberInput
                min={1}
                max={50}
                value={config.novelaiSettings.steps}
                onValueChange={(value) => onChange({
                  ...config,
                  novelaiSettings: { ...config.novelaiSettings, steps: value ?? 28 },
                })}
                className="setting-input"
              />
            </div>
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.novelaiSettings.scale')}</span>
                <span className="label-hint">{t('settings.imageGen.novelaiSettings.scaleHint')}</span>
              </label>
              <NumberInput
                min={1}
                max={20}
                step={0.5}
                integer={false}
                value={config.novelaiSettings.scale}
                onValueChange={(value) => onChange({
                  ...config,
                  novelaiSettings: { ...config.novelaiSettings, scale: value ?? 6 },
                })}
                className="setting-input"
              />
            </div>
            <div className="setting-item">
              <label className="setting-label">
                <span className="label-text">{t('settings.imageGen.novelaiSettings.noiseSchedule')}</span>
                <span className="label-hint">{t('settings.imageGen.novelaiSettings.noiseScheduleHint')}</span>
              </label>
              <CustomSelect
                value={config.novelaiSettings.noise_schedule}
                onChange={(value) => onChange({
                  ...config,
                  novelaiSettings: { ...config.novelaiSettings, noise_schedule: value },
                })}
                options={NOVELAI_NOISE_SCHEDULES.map((value) => ({ value, label: value }))}
              />
            </div>
          </div>
        </div>
      )}

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
          <div className="style-select-row">
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
            <TextButton variant="secondary" size="sm" onClick={() => setShowStyleModal(true)}>
              {t('settings.imageGen.styleEditor.editStyles')}
            </TextButton>
          </div>
        </div>
      </div>

      {showStyleModal && isTagBased ? (
        <ImageStyleEditorModal
          isOpen={showStyleModal}
          onClose={() => setShowStyleModal(false)}
          mode="tag_based"
          styles={config.tagBasedStyles}
          onChange={(styles) => onChange({ ...config, tagBasedStyles: styles })}
        />
      ) : null}

      {showStyleModal && !isTagBased ? (
        <ImageStyleEditorModal
          isOpen={showStyleModal}
          onClose={() => setShowStyleModal(false)}
          mode="natural"
          styles={config.naturalStyles}
          onChange={(styles) => onChange({ ...config, naturalStyles: styles })}
        />
      ) : null}
    </div>
  );
};

export default ImageGenPanel;

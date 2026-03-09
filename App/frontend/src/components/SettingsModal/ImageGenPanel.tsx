import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    ImageGenConfig,
    ImageProviderType,
} from '../../store/settingsStore';
import {
    MODEL_OPTIONS,
    NOVELAI_NOISE_SCHEDULES,
    NOVELAI_SAMPLERS,
    OPENAI_BACKGROUND_OPTIONS,
    OPENAI_INPUT_FIDELITY_OPTIONS,
    OPENAI_OUTPUT_FORMAT_OPTIONS,
    OPENAI_QUALITY_OPTIONS,
    PROVIDER_LABELS,
    PROVIDER_PROMPT_TYPES,
    getDefaultModel,
    getDefaultSize,
    getGeminiAspectRatioOptions,
    getGeminiResolutionOptions,
    getSizeOptions,
} from '../../imageRun/providerConfig';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import { NumberInput } from '../ui/NumberInput';
import ImageStyleEditorModal from './ImageStyleEditorModal';
import './ImageGenPanel.css';

interface ImageGenPanelProps {
    config: ImageGenConfig;
    onChange: (config: ImageGenConfig) => void;
}

const ImageGenPanel: React.FC<ImageGenPanelProps> = ({ config, onChange }) => {
    const { t } = useTranslation();
    const [showStyleModal, setShowStyleModal] = useState(false);
    const currentPromptType = PROVIDER_PROMPT_TYPES[config.provider];
    const isTagBased = currentPromptType === 'tag_based';
    const isNovelAI = config.provider === 'novelai';
    const isOpenAI = config.provider === 'openai';
    const isGemini = config.provider === 'gemini';

    const handleProviderChange = (provider: ImageProviderType) => {
        const defaultModel = getDefaultModel(provider);
        const defaultSize = getDefaultSize(provider, defaultModel);
        const nextConfig: ImageGenConfig = {
            ...config,
            provider,
            model: defaultModel,
            size: defaultSize,
        };

        if (provider === 'gemini') {
            const aspectRatios = getGeminiAspectRatioOptions(defaultModel);
            const resolutions = getGeminiResolutionOptions(defaultModel);
            nextConfig.geminiSettings = {
                ...config.geminiSettings,
                aspect_ratio: aspectRatios[0] || '1:1',
                image_resolution: resolutions[0] || '1K',
            };
        }

        onChange(nextConfig);
    };

    const handleModelChange = (model: string) => {
        if (config.provider === 'gemini') {
            const aspectRatios = getGeminiAspectRatioOptions(model);
            const resolutions = getGeminiResolutionOptions(model);
            onChange({
                ...config,
                model,
                geminiSettings: {
                    ...config.geminiSettings,
                    aspect_ratio: aspectRatios.includes(config.geminiSettings.aspect_ratio)
                        ? config.geminiSettings.aspect_ratio
                        : (aspectRatios[0] || '1:1'),
                    image_resolution: resolutions.includes(config.geminiSettings.image_resolution)
                        ? config.geminiSettings.image_resolution
                        : (resolutions[0] || '1K'),
                },
            });
            return;
        }

        const sizeOptions = getSizeOptions(config.provider, model);
        onChange({
            ...config,
            model,
            size: sizeOptions.includes(config.size) ? config.size : (sizeOptions[0] || '1024x1024'),
        });
    };

    const currentModels = MODEL_OPTIONS[config.provider] || [];
    const currentSizes = getSizeOptions(config.provider, config.model);
    const currentGeminiAspectRatios = getGeminiAspectRatioOptions(config.model);
    const currentGeminiResolutions = getGeminiResolutionOptions(config.model);
    const compressionEnabled = config.openaiSettings.output_format !== 'png';

    return (
        <div className="image-gen-panel">
            <div className="panel-header">
                <h3>{t('settings.imageGen.title')}</h3>
                <p className="panel-description">
                    {t('settings.imageGen.description')}
                </p>
            </div>

            <div className="settings-grid">
                {/* Provider Selection */}
                <div className="setting-item">
                    <label className="setting-label">
                        <span className="label-text">{t('settings.imageGen.provider')}</span>
                        <span className="label-hint">{t('settings.imageGen.providerHint')}</span>
                    </label>
                    <CustomSelect
                        value={config.provider}
                        onChange={(value) => handleProviderChange(value as ImageProviderType)}
                        options={(Object.keys(PROVIDER_LABELS) as ImageProviderType[]).map((p) => ({
                            value: p,
                            label: PROVIDER_LABELS[p],
                        }))}
                    />
                </div>

                {/* Model Selection */}
                <div className="setting-item">
                    <label className="setting-label">
                        <span className="label-text">{t('settings.imageGen.model')}</span>
                        <span className="label-hint">{t('settings.imageGen.modelHint')}</span>
                    </label>
                    <CustomSelect
                        value={config.model}
                        onChange={handleModelChange}
                        options={currentModels.map((m) => ({
                            value: m.id,
                            label: m.name,
                        }))}
                    />
                </div>

                {/* Size Selection - Gemini uses aspect ratio + resolution instead */}
                {isGemini ? (
                    <>
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">{t('settings.imageGen.aspectRatio')}</span>
                                <span className="label-hint">{t('settings.imageGen.aspectRatioHint')}</span>
                            </label>
                            <CustomSelect
                                value={config.geminiSettings.aspect_ratio}
                                onChange={(value) => onChange({
                                    ...config,
                                    geminiSettings: {
                                        ...config.geminiSettings,
                                        aspect_ratio: value,
                                    },
                                })}
                                options={currentGeminiAspectRatios.map((ar) => ({
                                    value: ar,
                                    label: ar,
                                }))}
                            />
                        </div>
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">{t('settings.imageGen.resolution')}</span>
                                <span className="label-hint">{t('settings.imageGen.resolutionHint')}</span>
                            </label>
                            <CustomSelect
                                value={config.geminiSettings.image_resolution}
                                onChange={(value) => onChange({
                                    ...config,
                                    geminiSettings: {
                                        ...config.geminiSettings,
                                        image_resolution: value,
                                    },
                                })}
                                options={currentGeminiResolutions.map((r) => ({
                                    value: r,
                                    label: r,
                                }))}
                            />
                        </div>
                    </>
                ) : (
                    <div className="setting-item">
                        <label className="setting-label">
                            <span className="label-text">{t('settings.imageGen.size')}</span>
                            <span className="label-hint">{t('settings.imageGen.sizeHint')}</span>
                        </label>
                        <CustomSelect
                            value={config.size}
                            onChange={(value) => onChange({ ...config, size: value })}
                            options={currentSizes.map((s) => ({
                                value: s,
                                label: s,
                            }))}
                        />
                    </div>
                )}
            </div>

            {/* OpenAI-specific settings */}
            {isOpenAI && (
                <div className="provider-settings-section">
                    <div className="section-header">
                        <h4>{t('settings.imageGen.openaiSettings.title')}</h4>
                        <p className="section-description">
                            {t('settings.imageGen.openaiSettings.description')}
                        </p>
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
                                    openaiSettings: {
                                        ...config.openaiSettings,
                                        quality: value as 'auto' | 'low' | 'medium' | 'high',
                                    },
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
                                    openaiSettings: {
                                        ...config.openaiSettings,
                                        background: value as 'auto' | 'opaque' | 'transparent',
                                    },
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
                                    openaiSettings: {
                                        ...config.openaiSettings,
                                        output_format: value as 'png' | 'jpeg' | 'webp',
                                    },
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
                                onValueChange={(v) => onChange({
                                    ...config,
                                    openaiSettings: {
                                        ...config.openaiSettings,
                                        output_compression: v ?? 90,
                                    },
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
                                    openaiSettings: {
                                        ...config.openaiSettings,
                                        input_fidelity: value as 'low' | 'high',
                                    },
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

            {/* NovelAI-specific settings */}
            {isNovelAI && (
                <div className="provider-settings-section">
                    <div className="section-header">
                        <h4>{t('settings.imageGen.novelaiSettings.title')}</h4>
                        <p className="section-description">
                            {t('settings.imageGen.novelaiSettings.description')}
                        </p>
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
                                    novelaiSettings: {
                                        ...config.novelaiSettings,
                                        sampler: value,
                                    },
                                })}
                                options={NOVELAI_SAMPLERS.map((s) => ({
                                    value: s,
                                    label: s,
                                }))}
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
                                onValueChange={(v) => onChange({
                                    ...config,
                                    novelaiSettings: {
                                        ...config.novelaiSettings,
                                        steps: v!,
                                    },
                                })}
                                className="setting-input"
                            />
                        </div>
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">{t('settings.imageGen.novelaiSettings.cfgScale')}</span>
                                <span className="label-hint">{t('settings.imageGen.novelaiSettings.cfgScaleHint')}</span>
                            </label>
                            <NumberInput
                                min={1}
                                max={20}
                                step={0.5}
                                integer={false}
                                value={config.novelaiSettings.scale}
                                onValueChange={(v) => onChange({
                                    ...config,
                                    novelaiSettings: {
                                        ...config.novelaiSettings,
                                        scale: v!,
                                    },
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
                                    novelaiSettings: {
                                        ...config.novelaiSettings,
                                        noise_schedule: value,
                                    },
                                })}
                                options={NOVELAI_NOISE_SCHEDULES.map((s) => ({
                                    value: s,
                                    label: s,
                                }))}
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Styles Section */}
            <div className="custom-styles-section">
                <div className="section-header">
                    <h4>{isTagBased ? t('settings.imageGen.tagBasedStyles.title') : t('settings.imageGen.naturalStyles.title')}</h4>
                    <p className="section-description">
                        {isTagBased ? t('settings.imageGen.tagBasedStyles.description') : t('settings.imageGen.naturalStyles.description')}
                    </p>
                </div>

                <div className="setting-item">
                    <label className="setting-label">
                        <span className="label-text">{t('settings.imageGen.naturalStyles.defaultStyle')}</span>
                        <span className="label-hint">{t('settings.imageGen.naturalStyles.defaultStyleHint')}</span>
                    </label>
                    <div className="style-select-row">
                        <CustomSelect
                            value={isTagBased ? (config.selectedTagBasedStyleId || '') : (config.selectedNaturalStyleId || '')}
                            onChange={(value) => onChange({
                                ...config,
                                ...(isTagBased
                                    ? { selectedTagBasedStyleId: value || null }
                                    : { selectedNaturalStyleId: value || null }
                                ),
                            })}
                            options={[
                                { value: '', label: t('settings.imageGen.naturalStyles.none') },
                                ...(isTagBased ? config.tagBasedStyles : config.naturalStyles).map((s) => ({
                                    value: s.id,
                                    label: s.name,
                                })),
                            ]}
                        />
                        <TextButton variant="secondary" size="sm" onClick={() => setShowStyleModal(true)}>
                            {t('settings.imageGen.styleEditor.editStyles')}
                        </TextButton>
                    </div>
                </div>
            </div>

            {/* Style Editor Modal */}
            {showStyleModal && (
                isTagBased ? (
                    <ImageStyleEditorModal
                        isOpen={showStyleModal}
                        onClose={() => setShowStyleModal(false)}
                        mode="tag_based"
                        styles={config.tagBasedStyles}
                        onChange={(styles) => onChange({
                            ...config,
                            tagBasedStyles: styles,
                            selectedTagBasedStyleId: config.selectedTagBasedStyleId && styles.some(s => s.id === config.selectedTagBasedStyleId)
                                ? config.selectedTagBasedStyleId
                                : null,
                        })}
                    />
                ) : (
                    <ImageStyleEditorModal
                        isOpen={showStyleModal}
                        onClose={() => setShowStyleModal(false)}
                        mode="natural"
                        styles={config.naturalStyles}
                        onChange={(styles) => onChange({
                            ...config,
                            naturalStyles: styles,
                            selectedNaturalStyleId: config.selectedNaturalStyleId && styles.some(s => s.id === config.selectedNaturalStyleId)
                                ? config.selectedNaturalStyleId
                                : null,
                        })}
                    />
                )
            )}

            <div className="panel-note">
                <strong>{t('common.note')}:</strong> {t('settings.imageGen.note')}
            </div>
        </div>
    );
};

export default ImageGenPanel;

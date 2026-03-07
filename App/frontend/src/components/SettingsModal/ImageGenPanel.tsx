import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
    ImageGenConfig,
    ImageProviderType,
} from '../../store/settingsStore';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
import { NumberInput } from '../ui/NumberInput';
import ImageStyleEditorModal from './ImageStyleEditorModal';
import './ImageGenPanel.css';

interface ImageGenPanelProps {
    config: ImageGenConfig;
    onChange: (config: ImageGenConfig) => void;
}

// Provider types
type ProviderPromptType = 'natural' | 'tag_based';

const PROVIDER_PROMPT_TYPES: Record<ImageProviderType, ProviderPromptType> = {
    openai: 'natural',
    gemini: 'natural',
    xai: 'natural',
    novelai: 'tag_based',
};

// Model options by provider
const MODEL_OPTIONS: Record<ImageProviderType, { id: string; name: string }[]> = {
    openai: [
        { id: 'gpt-image-1', name: 'GPT Image 1' },
        { id: 'dall-e-3', name: 'DALL-E 3' },
        { id: 'dall-e-2', name: 'DALL-E 2' },
    ],
    gemini: [
        { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image Preview' },
        { id: 'gemini-2.0-flash-preview-image-generation', name: 'Gemini 2.0 Flash Image' },
    ],
    xai: [
        { id: 'grok-2-image', name: 'Grok 2 Image' },
        { id: 'grok-2-image-1212', name: 'Grok 2 Image 1212' },
    ],
    novelai: [
        { id: 'nai-diffusion-4-5-full', name: 'NAI Diffusion V4.5 Full' },
        { id: 'nai-diffusion-4-5-curated', name: 'NAI Diffusion V4.5 Curated' },
    ],
};

// Size options by provider
const SIZE_OPTIONS: Record<ImageProviderType, string[]> = {
    openai: ['1024x1024', '1024x1792', '1792x1024', '512x512', '256x256'],
    gemini: [], // Gemini uses aspect_ratio + resolution separately
    xai: ['1024x1024', '1024x1792', '1792x1024'],
    novelai: ['1024x1024', '1216x832', '832x1216', '1472x704', '704x1472'],
};

// Gemini-specific options (uses aspect_ratio + image_size, not pixel dimensions)
const GEMINI_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
const GEMINI_RESOLUTIONS = ['1K', '2K', '4K'];

const PROVIDER_LABELS: Record<ImageProviderType, string> = {
    openai: 'OpenAI (DALL-E / GPT-Image)',
    gemini: 'Google Gemini',
    xai: 'xAI (Grok)',
    novelai: 'NovelAI',
};

// NovelAI-specific options
const NOVELAI_SAMPLERS = [
    'k_euler_ancestral',
    'k_euler',
    'k_dpmpp_2s_ancestral',
    'k_dpmpp_2m',
    'k_dpmpp_sde',
    'ddim_v3',
];

const NOVELAI_NOISE_SCHEDULES = [
    'native',
    'karras',
    'exponential',
    'polyexponential',
];

const ImageGenPanel: React.FC<ImageGenPanelProps> = ({ config, onChange }) => {
    const { t } = useTranslation();
    const [showStyleModal, setShowStyleModal] = useState(false);
    const currentPromptType = PROVIDER_PROMPT_TYPES[config.provider];
    const isTagBased = currentPromptType === 'tag_based';
    const isNovelAI = config.provider === 'novelai';
    const isOpenAI = config.provider === 'openai';
    const isGemini = config.provider === 'gemini';

    const handleProviderChange = (provider: ImageProviderType) => {
        const defaultModel = MODEL_OPTIONS[provider][0]?.id || '';
        const defaultSize = SIZE_OPTIONS[provider][0] || '1024x1024';

        onChange({
            ...config,
            provider,
            model: defaultModel,
            size: defaultSize,
        });
    };

    const currentModels = MODEL_OPTIONS[config.provider] || [];
    const currentSizes = SIZE_OPTIONS[config.provider] || ['1024x1024'];

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
                        onChange={(value) => onChange({ ...config, model: value })}
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
                                options={GEMINI_ASPECT_RATIOS.map((ar) => ({
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
                                options={GEMINI_RESOLUTIONS.map((r) => ({
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
                                        quality: value as 'standard' | 'hd',
                                    },
                                })}
                                options={[
                                    { value: 'standard', label: t('settings.imageGen.openaiSettings.standard') },
                                    { value: 'hd', label: t('settings.imageGen.openaiSettings.hd') },
                                ]}
                            />
                        </div>
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">{t('settings.imageGen.openaiSettings.style')}</span>
                                <span className="label-hint">{t('settings.imageGen.openaiSettings.styleHint')}</span>
                            </label>
                            <CustomSelect
                                value={config.openaiSettings.style}
                                onChange={(value) => onChange({
                                    ...config,
                                    openaiSettings: {
                                        ...config.openaiSettings,
                                        style: value as 'natural' | 'vivid',
                                    },
                                })}
                                options={[
                                    { value: 'natural', label: t('settings.imageGen.openaiSettings.natural') },
                                    { value: 'vivid', label: t('settings.imageGen.openaiSettings.vivid') },
                                ]}
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

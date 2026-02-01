import React from 'react';
import { useTranslation } from 'react-i18next';
import type {
    ImageGenConfig,
    ImageProviderType,
    NaturalImageStyle,
    TagBasedImageStyle,
} from '../../store/settingsStore';
import { generateTempId } from '../../utils/tempId';
import { TextButton } from '../TextButton';
import { CustomSelect } from '../ui/CustomSelect';
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

const generateId = (): string => generateTempId();

const ImageGenPanel: React.FC<ImageGenPanelProps> = ({ config, onChange }) => {
    const { t } = useTranslation();
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

    // Natural style handlers
    const handleAddNaturalStyle = () => {
        const newStyle: NaturalImageStyle = {
            id: generateId(),
            name: 'New Style',
            prefix: '',
            postfix: '',
        };
        onChange({
            ...config,
            naturalStyles: [...config.naturalStyles, newStyle],
        });
    };

    const handleUpdateNaturalStyle = (id: string, updates: Partial<NaturalImageStyle>) => {
        onChange({
            ...config,
            naturalStyles: config.naturalStyles.map(s =>
                s.id === id ? { ...s, ...updates } : s
            ),
        });
    };

    const handleDeleteNaturalStyle = (id: string) => {
        onChange({
            ...config,
            naturalStyles: config.naturalStyles.filter(s => s.id !== id),
            selectedNaturalStyleId: config.selectedNaturalStyleId === id ? null : config.selectedNaturalStyleId,
        });
    };

    // Tag-based style handlers
    const handleAddTagBasedStyle = () => {
        const newStyle: TagBasedImageStyle = {
            id: generateId(),
            name: 'New Style',
            positivePrefix: '',
            positivePostfix: '',
            negativePrefix: '',
            negativePostfix: '',
        };
        onChange({
            ...config,
            tagBasedStyles: [...config.tagBasedStyles, newStyle],
        });
    };

    const handleUpdateTagBasedStyle = (id: string, updates: Partial<TagBasedImageStyle>) => {
        onChange({
            ...config,
            tagBasedStyles: config.tagBasedStyles.map(s =>
                s.id === id ? { ...s, ...updates } : s
            ),
        });
    };

    const handleDeleteTagBasedStyle = (id: string) => {
        onChange({
            ...config,
            tagBasedStyles: config.tagBasedStyles.filter(s => s.id !== id),
            selectedTagBasedStyleId: config.selectedTagBasedStyleId === id ? null : config.selectedTagBasedStyleId,
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
                            <input
                                type="number"
                                min={1}
                                max={50}
                                value={config.novelaiSettings.steps}
                                onChange={(e) => onChange({
                                    ...config,
                                    novelaiSettings: {
                                        ...config.novelaiSettings,
                                        steps: parseInt(e.target.value) || 28,
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
                            <input
                                type="number"
                                min={1}
                                max={20}
                                step={0.5}
                                value={config.novelaiSettings.scale}
                                onChange={(e) => onChange({
                                    ...config,
                                    novelaiSettings: {
                                        ...config.novelaiSettings,
                                        scale: parseFloat(e.target.value) || 6,
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

            {/* Natural Language Custom Styles Section */}
            {!isTagBased && (
                <div className="custom-styles-section">
                    <div className="section-header">
                        <h4>{t('settings.imageGen.naturalStyles.title')}</h4>
                        <p className="section-description">
                            {t('settings.imageGen.naturalStyles.description')}
                        </p>
                    </div>

                    <div className="setting-item">
                        <label className="setting-label">
                            <span className="label-text">{t('settings.imageGen.naturalStyles.defaultStyle')}</span>
                            <span className="label-hint">{t('settings.imageGen.naturalStyles.defaultStyleHint')}</span>
                        </label>
                        <div className="style-select-row">
                            <CustomSelect
                                value={config.selectedNaturalStyleId || ''}
                                onChange={(value) => onChange({ ...config, selectedNaturalStyleId: value || null })}
                                options={[
                                    { value: '', label: t('settings.imageGen.naturalStyles.none') },
                                    ...config.naturalStyles.map((s) => ({
                                        value: s.id,
                                        label: s.name,
                                    })),
                                ]}
                            />
                            <TextButton variant="secondary" size="sm" onClick={handleAddNaturalStyle}>
                                {t('settings.imageGen.naturalStyles.addNew')}
                            </TextButton>
                        </div>
                    </div>

                    {config.naturalStyles.length > 0 && (
                        <div className="custom-styles-list">
                            {config.naturalStyles.map((style) => (
                                <div key={style.id} className="custom-style-item">
                                    <div className="style-header">
                                        <input
                                            type="text"
                                            value={style.name}
                                            onChange={(e) => handleUpdateNaturalStyle(style.id, { name: e.target.value })}
                                            className="style-name-input"
                                            placeholder={t('settings.imageGen.naturalStyles.styleName')}
                                        />
                                        <button
                                            className="delete-style-button"
                                            onClick={() => handleDeleteNaturalStyle(style.id)}
                                            title={t('settings.imageGen.naturalStyles.deleteStyle')}
                                        >
                                            &times;
                                        </button>
                                    </div>
                                    <div className="style-fields">
                                        <div className="style-field">
                                            <label>{t('settings.imageGen.naturalStyles.prefix')}</label>
                                            <input
                                                type="text"
                                                value={style.prefix}
                                                onChange={(e) => handleUpdateNaturalStyle(style.id, { prefix: e.target.value })}
                                                placeholder={t('settings.imageGen.naturalStyles.prefixPlaceholder')}
                                            />
                                        </div>
                                        <div className="style-field">
                                            <label>{t('settings.imageGen.naturalStyles.postfix')}</label>
                                            <input
                                                type="text"
                                                value={style.postfix}
                                                onChange={(e) => handleUpdateNaturalStyle(style.id, { postfix: e.target.value })}
                                                placeholder={t('settings.imageGen.naturalStyles.postfixPlaceholder')}
                                            />
                                        </div>
                                    </div>
                                    {(style.prefix || style.postfix) && (
                                        <div className="style-preview">
                                            <span className="preview-label">{t('settings.imageGen.naturalStyles.preview')}</span>
                                            <span className="preview-text">
                                                {style.prefix}<em>[prompt]</em>{style.postfix}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Tag-Based Custom Styles Section */}
            {isTagBased && (
                <div className="custom-styles-section">
                    <div className="section-header">
                        <h4>{t('settings.imageGen.tagBasedStyles.title')}</h4>
                        <p className="section-description">
                            {t('settings.imageGen.tagBasedStyles.description')}
                        </p>
                    </div>

                    <div className="setting-item">
                        <label className="setting-label">
                            <span className="label-text">{t('settings.imageGen.naturalStyles.defaultStyle')}</span>
                            <span className="label-hint">{t('settings.imageGen.naturalStyles.defaultStyleHint')}</span>
                        </label>
                        <div className="style-select-row">
                            <CustomSelect
                                value={config.selectedTagBasedStyleId || ''}
                                onChange={(value) => onChange({ ...config, selectedTagBasedStyleId: value || null })}
                                options={[
                                    { value: '', label: t('settings.imageGen.naturalStyles.none') },
                                    ...config.tagBasedStyles.map((s) => ({
                                        value: s.id,
                                        label: s.name,
                                    })),
                                ]}
                            />
                            <TextButton variant="secondary" size="sm" onClick={handleAddTagBasedStyle}>
                                {t('settings.imageGen.naturalStyles.addNew')}
                            </TextButton>
                        </div>
                    </div>

                    {config.tagBasedStyles.length > 0 && (
                        <div className="custom-styles-list">
                            {config.tagBasedStyles.map((style) => (
                                <div key={style.id} className="custom-style-item">
                                    <div className="style-header">
                                        <input
                                            type="text"
                                            value={style.name}
                                            onChange={(e) => handleUpdateTagBasedStyle(style.id, { name: e.target.value })}
                                            className="style-name-input"
                                            placeholder={t('settings.imageGen.naturalStyles.styleName')}
                                        />
                                        <button
                                            className="delete-style-button"
                                            onClick={() => handleDeleteTagBasedStyle(style.id)}
                                            title={t('settings.imageGen.naturalStyles.deleteStyle')}
                                        >
                                            &times;
                                        </button>
                                    </div>
                                    <div className="style-fields tag-based-fields">
                                        <div className="style-field-group">
                                            <label className="field-group-label">{t('settings.imageGen.tagBasedStyles.positivePrompt')}</label>
                                            <div className="field-row">
                                                <div className="style-field">
                                                    <label>{t('settings.imageGen.naturalStyles.prefix')}</label>
                                                    <input
                                                        type="text"
                                                        value={style.positivePrefix}
                                                        onChange={(e) => handleUpdateTagBasedStyle(style.id, { positivePrefix: e.target.value })}
                                                        placeholder={t('settings.imageGen.naturalStyles.prefixPlaceholder')}
                                                    />
                                                </div>
                                                <div className="style-field">
                                                    <label>{t('settings.imageGen.naturalStyles.postfix')}</label>
                                                    <input
                                                        type="text"
                                                        value={style.positivePostfix}
                                                        onChange={(e) => handleUpdateTagBasedStyle(style.id, { positivePostfix: e.target.value })}
                                                        placeholder={t('settings.imageGen.naturalStyles.postfixPlaceholder')}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="style-field-group">
                                            <label className="field-group-label">{t('settings.imageGen.tagBasedStyles.negativePrompt')}</label>
                                            <div className="field-row">
                                                <div className="style-field">
                                                    <label>{t('settings.imageGen.naturalStyles.prefix')}</label>
                                                    <input
                                                        type="text"
                                                        value={style.negativePrefix}
                                                        onChange={(e) => handleUpdateTagBasedStyle(style.id, { negativePrefix: e.target.value })}
                                                        placeholder={t('settings.imageGen.naturalStyles.prefixPlaceholder')}
                                                    />
                                                </div>
                                                <div className="style-field">
                                                    <label>{t('settings.imageGen.naturalStyles.postfix')}</label>
                                                    <input
                                                        type="text"
                                                        value={style.negativePostfix}
                                                        onChange={(e) => handleUpdateTagBasedStyle(style.id, { negativePostfix: e.target.value })}
                                                        placeholder={t('settings.imageGen.naturalStyles.postfixPlaceholder')}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    {(style.positivePrefix || style.positivePostfix || style.negativePrefix || style.negativePostfix) && (
                                        <div className="style-preview tag-based">
                                            <div className="preview-row">
                                                <span className="preview-label positive">+</span>
                                                <span className="preview-text">
                                                    {style.positivePrefix}<em>[prompt]</em>{style.positivePostfix}
                                                </span>
                                            </div>
                                            <div className="preview-row">
                                                <span className="preview-label negative">−</span>
                                                <span className="preview-text">
                                                    {style.negativePrefix}<em>[prompt]</em>{style.negativePostfix}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <div className="panel-note">
                <strong>{t('common.note')}:</strong> {t('settings.imageGen.note')}
            </div>
        </div>
    );
};

export default ImageGenPanel;

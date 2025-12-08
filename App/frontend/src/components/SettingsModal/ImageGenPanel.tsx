import React from 'react';
import type {
    ImageGenConfig,
    ImageProviderType,
    NaturalImageStyle,
    TagBasedImageStyle,
} from '../../store/settingsStore';
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

const generateId = () => crypto.randomUUID();

const ImageGenPanel: React.FC<ImageGenPanelProps> = ({ config, onChange }) => {
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
                <h3>Image Generation Defaults</h3>
                <p className="panel-description">
                    Configure default settings for AI image generation. These can be overridden when generating images.
                </p>
            </div>

            <div className="settings-grid">
                {/* Provider Selection */}
                <div className="setting-item">
                    <label className="setting-label">
                        <span className="label-text">Provider</span>
                        <span className="label-hint">Choose the AI provider for image generation</span>
                    </label>
                    <select
                        value={config.provider}
                        onChange={(e) => handleProviderChange(e.target.value as ImageProviderType)}
                        className="setting-select"
                    >
                        {(Object.keys(PROVIDER_LABELS) as ImageProviderType[]).map((p) => (
                            <option key={p} value={p}>
                                {PROVIDER_LABELS[p]}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Model Selection */}
                <div className="setting-item">
                    <label className="setting-label">
                        <span className="label-text">Model</span>
                        <span className="label-hint">Select the image generation model</span>
                    </label>
                    <select
                        value={config.model}
                        onChange={(e) => onChange({ ...config, model: e.target.value })}
                        className="setting-select"
                    >
                        {currentModels.map((m) => (
                            <option key={m.id} value={m.id}>
                                {m.name}
                            </option>
                        ))}
                    </select>
                </div>

                {/* Size Selection - Gemini uses aspect ratio + resolution instead */}
                {isGemini ? (
                    <>
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">Aspect Ratio</span>
                                <span className="label-hint">Image aspect ratio</span>
                            </label>
                            <select
                                value={config.geminiSettings.aspect_ratio}
                                onChange={(e) => onChange({
                                    ...config,
                                    geminiSettings: {
                                        ...config.geminiSettings,
                                        aspect_ratio: e.target.value,
                                    },
                                })}
                                className="setting-select"
                            >
                                {GEMINI_ASPECT_RATIOS.map((ar) => (
                                    <option key={ar} value={ar}>
                                        {ar}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">Resolution</span>
                                <span className="label-hint">Image resolution</span>
                            </label>
                            <select
                                value={config.geminiSettings.image_resolution}
                                onChange={(e) => onChange({
                                    ...config,
                                    geminiSettings: {
                                        ...config.geminiSettings,
                                        image_resolution: e.target.value,
                                    },
                                })}
                                className="setting-select"
                            >
                                {GEMINI_RESOLUTIONS.map((r) => (
                                    <option key={r} value={r}>
                                        {r}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </>
                ) : (
                    <div className="setting-item">
                        <label className="setting-label">
                            <span className="label-text">Size</span>
                            <span className="label-hint">Default image dimensions</span>
                        </label>
                        <select
                            value={config.size}
                            onChange={(e) => onChange({ ...config, size: e.target.value })}
                            className="setting-select"
                        >
                            {currentSizes.map((s) => (
                                <option key={s} value={s}>
                                    {s}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* OpenAI-specific settings */}
            {isOpenAI && (
                <div className="provider-settings-section">
                    <div className="section-header">
                        <h4>OpenAI Settings</h4>
                        <p className="section-description">
                            Configure OpenAI-specific image generation options.
                        </p>
                    </div>
                    <div className="settings-grid">
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">Quality</span>
                                <span className="label-hint">Image quality level</span>
                            </label>
                            <select
                                value={config.openaiSettings.quality}
                                onChange={(e) => onChange({
                                    ...config,
                                    openaiSettings: {
                                        ...config.openaiSettings,
                                        quality: e.target.value as 'standard' | 'hd',
                                    },
                                })}
                                className="setting-select"
                            >
                                <option value="standard">Standard</option>
                                <option value="hd">HD</option>
                            </select>
                        </div>
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">Style</span>
                                <span className="label-hint">Image style preference</span>
                            </label>
                            <select
                                value={config.openaiSettings.style}
                                onChange={(e) => onChange({
                                    ...config,
                                    openaiSettings: {
                                        ...config.openaiSettings,
                                        style: e.target.value as 'natural' | 'vivid',
                                    },
                                })}
                                className="setting-select"
                            >
                                <option value="natural">Natural</option>
                                <option value="vivid">Vivid</option>
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {/* NovelAI-specific settings */}
            {isNovelAI && (
                <div className="provider-settings-section">
                    <div className="section-header">
                        <h4>NovelAI Settings</h4>
                        <p className="section-description">
                            Configure NovelAI-specific image generation options.
                        </p>
                    </div>
                    <div className="settings-grid novelai-settings">
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">Sampler</span>
                                <span className="label-hint">Sampling algorithm</span>
                            </label>
                            <select
                                value={config.novelaiSettings.sampler}
                                onChange={(e) => onChange({
                                    ...config,
                                    novelaiSettings: {
                                        ...config.novelaiSettings,
                                        sampler: e.target.value,
                                    },
                                })}
                                className="setting-select"
                            >
                                {NOVELAI_SAMPLERS.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                        <div className="setting-item">
                            <label className="setting-label">
                                <span className="label-text">Steps</span>
                                <span className="label-hint">Number of sampling steps (1-50)</span>
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
                                <span className="label-text">CFG Scale</span>
                                <span className="label-hint">Prompt guidance strength (1-20)</span>
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
                                <span className="label-text">Noise Schedule</span>
                                <span className="label-hint">Noise scheduling method</span>
                            </label>
                            <select
                                value={config.novelaiSettings.noise_schedule}
                                onChange={(e) => onChange({
                                    ...config,
                                    novelaiSettings: {
                                        ...config.novelaiSettings,
                                        noise_schedule: e.target.value,
                                    },
                                })}
                                className="setting-select"
                            >
                                {NOVELAI_NOISE_SCHEDULES.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            )}

            {/* Natural Language Custom Styles Section */}
            {!isTagBased && (
                <div className="custom-styles-section">
                    <div className="section-header">
                        <h4>Custom Styles (Natural Language)</h4>
                        <p className="section-description">
                            Create custom styles with prefix and postfix text that wrap around your prompts.
                        </p>
                    </div>

                    <div className="setting-item">
                        <label className="setting-label">
                            <span className="label-text">Default Style</span>
                            <span className="label-hint">Style to apply by default when generating images</span>
                        </label>
                        <select
                            value={config.selectedNaturalStyleId || ''}
                            onChange={(e) => onChange({ ...config, selectedNaturalStyleId: e.target.value || null })}
                            className="setting-select"
                        >
                            <option value="">None</option>
                            {config.naturalStyles.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <button className="add-style-button" onClick={handleAddNaturalStyle}>
                        + Add New Style
                    </button>

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
                                            placeholder="Style Name"
                                        />
                                        <button
                                            className="delete-style-button"
                                            onClick={() => handleDeleteNaturalStyle(style.id)}
                                            title="Delete style"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                    <div className="style-fields">
                                        <div className="style-field">
                                            <label>Prefix</label>
                                            <input
                                                type="text"
                                                value={style.prefix}
                                                onChange={(e) => handleUpdateNaturalStyle(style.id, { prefix: e.target.value })}
                                                placeholder="Text prepended to prompt..."
                                            />
                                        </div>
                                        <div className="style-field">
                                            <label>Postfix</label>
                                            <input
                                                type="text"
                                                value={style.postfix}
                                                onChange={(e) => handleUpdateNaturalStyle(style.id, { postfix: e.target.value })}
                                                placeholder="Text appended to prompt..."
                                            />
                                        </div>
                                    </div>
                                    {(style.prefix || style.postfix) && (
                                        <div className="style-preview">
                                            <span className="preview-label">Preview:</span>
                                            <span className="preview-text">
                                                {style.prefix}<em>[your prompt]</em>{style.postfix}
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
                        <h4>Custom Styles (Tag-Based)</h4>
                        <p className="section-description">
                            Create custom styles with prefix and postfix for both positive and negative prompts.
                        </p>
                    </div>

                    <div className="setting-item">
                        <label className="setting-label">
                            <span className="label-text">Default Style</span>
                            <span className="label-hint">Style to apply by default when generating images</span>
                        </label>
                        <select
                            value={config.selectedTagBasedStyleId || ''}
                            onChange={(e) => onChange({ ...config, selectedTagBasedStyleId: e.target.value || null })}
                            className="setting-select"
                        >
                            <option value="">None</option>
                            {config.tagBasedStyles.map((s) => (
                                <option key={s.id} value={s.id}>
                                    {s.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <button className="add-style-button" onClick={handleAddTagBasedStyle}>
                        + Add New Style
                    </button>

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
                                            placeholder="Style Name"
                                        />
                                        <button
                                            className="delete-style-button"
                                            onClick={() => handleDeleteTagBasedStyle(style.id)}
                                            title="Delete style"
                                        >
                                            &times;
                                        </button>
                                    </div>
                                    <div className="style-fields tag-based-fields">
                                        <div className="style-field-group">
                                            <label className="field-group-label">Positive Prompt</label>
                                            <div className="field-row">
                                                <div className="style-field">
                                                    <label>Prefix</label>
                                                    <input
                                                        type="text"
                                                        value={style.positivePrefix}
                                                        onChange={(e) => handleUpdateTagBasedStyle(style.id, { positivePrefix: e.target.value })}
                                                        placeholder="masterpiece, best quality, "
                                                    />
                                                </div>
                                                <div className="style-field">
                                                    <label>Postfix</label>
                                                    <input
                                                        type="text"
                                                        value={style.positivePostfix}
                                                        onChange={(e) => handleUpdateTagBasedStyle(style.id, { positivePostfix: e.target.value })}
                                                        placeholder=", detailed eyes"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                        <div className="style-field-group">
                                            <label className="field-group-label">Negative Prompt</label>
                                            <div className="field-row">
                                                <div className="style-field">
                                                    <label>Prefix</label>
                                                    <input
                                                        type="text"
                                                        value={style.negativePrefix}
                                                        onChange={(e) => handleUpdateTagBasedStyle(style.id, { negativePrefix: e.target.value })}
                                                        placeholder="lowres, "
                                                    />
                                                </div>
                                                <div className="style-field">
                                                    <label>Postfix</label>
                                                    <input
                                                        type="text"
                                                        value={style.negativePostfix}
                                                        onChange={(e) => handleUpdateTagBasedStyle(style.id, { negativePostfix: e.target.value })}
                                                        placeholder=", bad anatomy"
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
                <strong>Note:</strong> Make sure you have configured the API key for the selected provider in the Credentials tab.
            </div>
        </div>
    );
};

export default ImageGenPanel;

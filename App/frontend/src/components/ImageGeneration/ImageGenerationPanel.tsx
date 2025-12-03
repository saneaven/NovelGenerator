import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAssetStore } from '../../store/assetStore';
import { useSettingsStore, type ImageProviderType } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import type { Asset } from '../../api/assetService';
import ImagePromptBuilderModal, { type PromptMode } from './ImagePromptBuilderModal';
import './ImageGenerationPanel.css';

interface ChapterContext {
    chapterId: string;
    chapterName: string;
    chapterDescription: string;
    actId: string;
    selectedText: string | null;
    scenePreContext?: string;
    scenePostContext?: string;
}

// Settings passed from asset detail for regeneration
interface RegenerateSettings {
    provider: string;
    model: string;
    prompt?: string;
    positive_prompt?: string;
    negative_prompt?: string;
    size?: string;
    settings?: Record<string, any>;
}

interface ImageGenerationPanelProps {
    onImageGenerated?: (asset: Asset) => void;
    onClose?: () => void;
    chapterContext?: ChapterContext;
    objectType?: string;
    objectId?: string;
    initialSettings?: RegenerateSettings | null;
}

// Provider prompt types
type PromptType = 'natural' | 'tag_based';

const PROVIDER_PROMPT_TYPES: Record<ImageProviderType, PromptType> = {
    openai: 'natural',
    gemini: 'natural',
    xai: 'natural',
    novelai: 'tag_based',
};

const PROVIDER_LABELS: Record<ImageProviderType, string> = {
    openai: 'OpenAI (DALL-E / GPT-Image)',
    gemini: 'Gemini',
    xai: 'xAI (Grok)',
    novelai: 'NovelAI',
};

const MODEL_OPTIONS: Record<ImageProviderType, { id: string; name: string }[]> = {
    openai: [
        { id: 'gpt-image-1', name: 'GPT Image 1' },
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

const SIZE_OPTIONS: Record<ImageProviderType, string[]> = {
    openai: ['1024x1024', '1024x1792', '1792x1024'],
    gemini: [],  // Gemini uses aspect_ratio + resolution separately
    xai: ['1024x1024', '1024x1792', '1792x1024'],
    novelai: ['1024x1024', '1216x832', '832x1216', '1472x704', '704x1472'],
};

// Gemini-specific options (uses aspect_ratio + image_size, not pixel dimensions)
const GEMINI_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'];
const GEMINI_RESOLUTIONS = ['1K', '2K', '4K'];

const NOVELAI_SAMPLERS = [
    'k_euler_ancestral',
    'k_euler',
    'k_dpmpp_2s_ancestral',
    'k_dpmpp_2m',
    'k_dpmpp_sde',
    'ddim_v3',
];

const NOVELAI_NOISE_SCHEDULES = ['native', 'karras', 'exponential', 'polyexponential'];

const ImageGenerationPanel: React.FC<ImageGenerationPanelProps> = ({
    onImageGenerated,
    onClose,
    // chapterContext is no longer used - ImagePromptBuilderModal now only supports object prompts
    objectType,
    objectId,
    initialSettings,
}) => {
    const { currentProjectId } = useProjectStore();
    const { isGenerating, error, fetchImageProviders, generateImage, clearError } = useAssetStore();
    const { settings } = useSettingsStore();
    const { objects, getObject } = useUnifiedObjectStore();

    // Get saved prompts from object metadata
    const savedPrompts = useMemo(() => {
        if (!objectId) return null;
        const obj = getObject(objectId);
        if (!obj?.metadata) return null;
        return {
            natural: obj.metadata.image_prompt || '',
            positive: obj.metadata.image_prompt_positive || '',
            negative: obj.metadata.image_prompt_negative || '',
        };
    }, [objectId, objects, getObject]);

    // Natural language prompt (for OpenAI, Gemini, xAI)
    const [prompt, setPrompt] = useState('');
    // Tag-based prompts (for NovelAI)
    const [positivePrompt, setPositivePrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    // Active tab for tag-based UI
    const [activePromptTab, setActivePromptTab] = useState<'positive' | 'negative'>('positive');

    const [showPromptBuilder, setShowPromptBuilder] = useState(false);
    const [provider, setProvider] = useState<ImageProviderType>(settings.imageGenConfig.provider);
    const [model, setModel] = useState(settings.imageGenConfig.model);
    const [size, setSize] = useState(settings.imageGenConfig.size);

    // Gemini-specific settings (aspect ratio + resolution instead of size)
    const [geminiAspectRatio, setGeminiAspectRatio] = useState(settings.imageGenConfig.geminiSettings.aspect_ratio);
    const [geminiResolution, setGeminiResolution] = useState(settings.imageGenConfig.geminiSettings.image_resolution);

    // Provider-specific settings
    const [openaiQuality, setOpenaiQuality] = useState(settings.imageGenConfig.openaiSettings.quality);
    const [openaiStyle, setOpenaiStyle] = useState(settings.imageGenConfig.openaiSettings.style);
    const [novelaiSampler, setNovelaiSampler] = useState(settings.imageGenConfig.novelaiSettings.sampler);
    const [novelaiSteps, setNovelaiSteps] = useState(settings.imageGenConfig.novelaiSettings.steps);
    const [novelaiScale, setNovelaiScale] = useState(settings.imageGenConfig.novelaiSettings.scale);
    const [novelaiNoiseSchedule, setNovelaiNoiseSchedule] = useState(settings.imageGenConfig.novelaiSettings.noise_schedule);

    // Style selection (separate for natural vs tag-based)
    const [selectedNaturalStyleId, setSelectedNaturalStyleId] = useState<string | null>(
        settings.imageGenConfig.selectedNaturalStyleId
    );
    const [selectedTagBasedStyleId, setSelectedTagBasedStyleId] = useState<string | null>(
        settings.imageGenConfig.selectedTagBasedStyleId
    );

    const isInitialMount = useRef(true);
    const previousProvider = useRef(provider);

    const currentPromptType = PROVIDER_PROMPT_TYPES[provider];
    const isTagBased = currentPromptType === 'tag_based';
    const naturalStyles = settings.imageGenConfig.naturalStyles || [];
    const tagBasedStyles = settings.imageGenConfig.tagBasedStyles || [];

    useEffect(() => {
        fetchImageProviders();
    }, [fetchImageProviders]);

    // Apply initial settings when regenerating from asset detail
    useEffect(() => {
        if (!initialSettings) return;

        // Set provider and model
        if (initialSettings.provider) {
            setProvider(initialSettings.provider as ImageProviderType);
        }
        if (initialSettings.model) {
            setModel(initialSettings.model);
        }

        // Set prompts
        if (initialSettings.prompt) {
            setPrompt(initialSettings.prompt);
        }
        if (initialSettings.positive_prompt) {
            setPositivePrompt(initialSettings.positive_prompt);
        }
        if (initialSettings.negative_prompt) {
            setNegativePrompt(initialSettings.negative_prompt);
        }

        // Set size
        if (initialSettings.size) {
            setSize(initialSettings.size);
        }

        // Apply provider-specific settings
        if (initialSettings.settings) {
            const s = initialSettings.settings;
            // OpenAI settings
            if (s.quality) setOpenaiQuality(s.quality);
            if (s.style) setOpenaiStyle(s.style);
            // NovelAI settings
            if (s.sampler) setNovelaiSampler(s.sampler);
            if (s.steps) setNovelaiSteps(s.steps);
            if (s.scale) setNovelaiScale(s.scale);
            if (s.noise_schedule) setNovelaiNoiseSchedule(s.noise_schedule);
            // Gemini settings
            if (s.aspect_ratio) setGeminiAspectRatio(s.aspect_ratio);
            if (s.image_resolution) setGeminiResolution(s.image_resolution);
        }
    }, [initialSettings]);

    // Auto-load saved prompts from object metadata
    useEffect(() => {
        if (savedPrompts) {
            const promptType = PROVIDER_PROMPT_TYPES[provider];
            if (promptType === 'natural' && savedPrompts.natural) {
                setPrompt(savedPrompts.natural);
            } else if (promptType === 'tag_based') {
                if (savedPrompts.positive) {
                    setPositivePrompt(savedPrompts.positive);
                }
                if (savedPrompts.negative) {
                    setNegativePrompt(savedPrompts.negative);
                }
            }
        }
    }, [objectId, provider, savedPrompts?.natural, savedPrompts?.positive, savedPrompts?.negative]);

    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        if (previousProvider.current !== provider) {
            previousProvider.current = provider;
            const defaultModel = MODEL_OPTIONS[provider]?.[0]?.id || '';
            const defaultSize = SIZE_OPTIONS[provider]?.[0] || '1024x1024';
            setModel(defaultModel);
            setSize(defaultSize);
        }
    }, [provider]);

    const getApiKey = (): string => {
        switch (provider) {
            case 'openai':
                return settings.providerCredentials.openai.apiKey;
            case 'gemini':
                return settings.providerCredentials.gemini.apiKey;
            case 'xai':
                return settings.providerCredentials.xai?.apiKey || '';
            case 'novelai':
                return settings.providerCredentials.novelai?.apiKey || '';
            default:
                return '';
        }
    };

    const getCurrentNaturalStyle = () => {
        if (!selectedNaturalStyleId) return null;
        return naturalStyles.find((s) => s.id === selectedNaturalStyleId) || null;
    };

    const getCurrentTagBasedStyle = () => {
        if (!selectedTagBasedStyleId) return null;
        return tagBasedStyles.find((s) => s.id === selectedTagBasedStyleId) || null;
    };

    const handleGenerate = async () => {
        if (!currentProjectId) return;

        const apiKey = getApiKey();
        if (!apiKey) {
            alert(`Please configure your ${PROVIDER_LABELS[provider]} API key in Settings > Credentials`);
            return;
        }

        try {
            clearError();

            if (isTagBased) {
                // Tag-based generation (NovelAI)
                if (!positivePrompt.trim()) {
                    alert('Please enter a positive prompt');
                    return;
                }

                let finalPositive = positivePrompt.trim();
                let finalNegative = negativePrompt.trim();

                // Apply tag-based style
                const tagStyle = getCurrentTagBasedStyle();
                if (tagStyle) {
                    if (tagStyle.positiveTags) {
                        finalPositive = `${finalPositive}, ${tagStyle.positiveTags}`;
                    }
                    if (tagStyle.negativeTags) {
                        finalNegative = finalNegative
                            ? `${finalNegative}, ${tagStyle.negativeTags}`
                            : tagStyle.negativeTags;
                    }
                }

                const asset = await generateImage(
                    currentProjectId,
                    {
                        positive_prompt: finalPositive,
                        negative_prompt: finalNegative || undefined,
                        provider,
                        model,
                        size,
                        provider_settings: {
                            sampler: novelaiSampler,
                            steps: novelaiSteps,
                            scale: novelaiScale,
                            noise_schedule: novelaiNoiseSchedule,
                        },
                    },
                    apiKey
                );

                if (asset && onImageGenerated) {
                    onImageGenerated(asset);
                }
            } else {
                // Natural language generation (OpenAI, Gemini, xAI)
                if (!prompt.trim()) {
                    alert('Please enter a prompt');
                    return;
                }

                let finalPrompt = prompt.trim();
                const naturalStyle = getCurrentNaturalStyle();
                if (naturalStyle) {
                    finalPrompt = `${naturalStyle.prefix}${finalPrompt}${naturalStyle.postfix}`;
                }

                const requestParams: any = {
                    prompt: finalPrompt,
                    provider,
                    model,
                    size: provider === 'gemini' ? undefined : size,
                };

                // Add OpenAI-specific settings
                if (provider === 'openai') {
                    requestParams.quality = openaiQuality;
                    requestParams.style = openaiStyle;
                }

                // Add Gemini-specific settings through provider_settings
                if (provider === 'gemini') {
                    requestParams.provider_settings = {
                        aspect_ratio: geminiAspectRatio,
                        image_resolution: geminiResolution,
                    };
                }

                const asset = await generateImage(currentProjectId, requestParams, apiKey);

                if (asset && onImageGenerated) {
                    onImageGenerated(asset);
                }
            }
        } catch (err) {
            // Error handled in store
        }
    };

    const handlePromptBuilderGenerated = (generatedPrompt: string) => {
        if (isTagBased) {
            // For tag-based, set based on current active tab
            if (activePromptTab === 'negative') {
                setNegativePrompt(generatedPrompt);
            } else {
                setPositivePrompt(generatedPrompt);
            }
        } else {
            setPrompt(generatedPrompt);
        }
    };

    const currentModelOptions = MODEL_OPTIONS[provider] || [];
    const currentSizeOptions = SIZE_OPTIONS[provider] || ['1024x1024'];

    return (
        <div className="image-generation-panel">
            <div className="panel-header">
                <h3>Generate Image</h3>
                {onClose && (
                    <button className="close-button" onClick={onClose}>
                        &times;
                    </button>
                )}
            </div>

            <div className="panel-body">
                {/* Saved prompt indicator */}
                {savedPrompts && (savedPrompts.natural || savedPrompts.positive) && (
                    <div className="saved-prompt-indicator">
                        Loaded saved prompt from object. Edit below or use as-is.
                    </div>
                )}

                {/* Natural Language Prompt Input */}
                {!isTagBased && (
                    <div className="form-field">
                        <label>Prompt</label>
                        <div className="prompt-input-wrapper">
                            <textarea
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="Describe the image you want to generate..."
                                rows={4}
                                className="prompt-input"
                            />
                            <button
                                className="ai-assist-button"
                                onClick={() => setShowPromptBuilder(true)}
                                title="AI-assisted prompt generation"
                                type="button"
                            >
                                ✨ AI Assist
                            </button>
                        </div>
                    </div>
                )}

                {/* Tag-Based Prompt Input with Tabs */}
                {isTagBased && (
                    <div className="form-field">
                        <label>Prompt</label>
                        <div className="prompt-tabs">
                            <button
                                className={`prompt-tab ${activePromptTab === 'positive' ? 'active' : ''}`}
                                onClick={() => setActivePromptTab('positive')}
                            >
                                Positive {positivePrompt && '✓'}
                            </button>
                            <button
                                className={`prompt-tab ${activePromptTab === 'negative' ? 'active' : ''}`}
                                onClick={() => setActivePromptTab('negative')}
                            >
                                Negative {negativePrompt && '✓'}
                            </button>
                        </div>
                        <div className="prompt-input-wrapper">
                            {activePromptTab === 'positive' ? (
                                <textarea
                                    value={positivePrompt}
                                    onChange={(e) => setPositivePrompt(e.target.value)}
                                    placeholder="1girl, solo, long hair, masterpiece, best quality, ..."
                                    rows={4}
                                    className="prompt-input"
                                />
                            ) : (
                                <textarea
                                    value={negativePrompt}
                                    onChange={(e) => setNegativePrompt(e.target.value)}
                                    placeholder="lowres, bad anatomy, bad hands, missing fingers, ..."
                                    rows={4}
                                    className="prompt-input"
                                />
                            )}
                            <button
                                className="ai-assist-button"
                                onClick={() => setShowPromptBuilder(true)}
                                title="AI-assisted prompt generation"
                                type="button"
                            >
                                ✨ AI Assist
                            </button>
                        </div>
                    </div>
                )}

                {/* Provider Selection */}
                <div className="form-row">
                    <div className="form-field">
                        <label>Provider</label>
                        <select
                            value={provider}
                            onChange={(e) => setProvider(e.target.value as ImageProviderType)}
                            className="config-select"
                        >
                            {(Object.keys(PROVIDER_LABELS) as ImageProviderType[]).map((p) => (
                                <option key={p} value={p}>
                                    {PROVIDER_LABELS[p]}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-field">
                        <label>Model</label>
                        <select
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            className="config-select"
                        >
                            {currentModelOptions.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Size and Style Selection */}
                <div className="form-row">
                    {/* Gemini uses aspect ratio + resolution instead of size */}
                    {provider === 'gemini' ? (
                        <>
                            <div className="form-field">
                                <label>Aspect Ratio</label>
                                <select
                                    value={geminiAspectRatio}
                                    onChange={(e) => setGeminiAspectRatio(e.target.value)}
                                    className="config-select"
                                >
                                    {GEMINI_ASPECT_RATIOS.map((ar) => (
                                        <option key={ar} value={ar}>
                                            {ar}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Resolution</label>
                                <select
                                    value={geminiResolution}
                                    onChange={(e) => setGeminiResolution(e.target.value)}
                                    className="config-select"
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
                        <div className="form-field">
                            <label>Size</label>
                            <select
                                value={size}
                                onChange={(e) => setSize(e.target.value)}
                                className="config-select"
                            >
                                {currentSizeOptions.map((s) => (
                                    <option key={s} value={s}>
                                        {s}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Style selector based on prompt type */}
                    {!isTagBased && (
                        <div className="form-field">
                            <label>Style</label>
                            <select
                                value={selectedNaturalStyleId || ''}
                                onChange={(e) => setSelectedNaturalStyleId(e.target.value || null)}
                                className="config-select"
                            >
                                <option value="">None</option>
                                {naturalStyles.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {isTagBased && (
                        <div className="form-field">
                            <label>Style</label>
                            <select
                                value={selectedTagBasedStyleId || ''}
                                onChange={(e) => setSelectedTagBasedStyleId(e.target.value || null)}
                                className="config-select"
                            >
                                <option value="">None</option>
                                {tagBasedStyles.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                {/* OpenAI-specific settings */}
                {provider === 'openai' && (
                    <div className="form-row provider-settings">
                        <div className="form-field">
                            <label>Quality</label>
                            <select
                                value={openaiQuality}
                                onChange={(e) => setOpenaiQuality(e.target.value as 'standard' | 'hd')}
                                className="config-select"
                            >
                                <option value="standard">Standard</option>
                                <option value="hd">HD</option>
                            </select>
                        </div>
                        <div className="form-field">
                            <label>Style</label>
                            <select
                                value={openaiStyle}
                                onChange={(e) => setOpenaiStyle(e.target.value as 'natural' | 'vivid')}
                                className="config-select"
                            >
                                <option value="natural">Natural</option>
                                <option value="vivid">Vivid</option>
                            </select>
                        </div>
                    </div>
                )}

                {/* NovelAI-specific settings */}
                {provider === 'novelai' && (
                    <div className="novelai-settings">
                        <div className="form-row">
                            <div className="form-field">
                                <label>Sampler</label>
                                <select
                                    value={novelaiSampler}
                                    onChange={(e) => setNovelaiSampler(e.target.value)}
                                    className="config-select"
                                >
                                    {NOVELAI_SAMPLERS.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Steps</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={novelaiSteps}
                                    onChange={(e) => setNovelaiSteps(parseInt(e.target.value) || 28)}
                                    className="config-input"
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-field">
                                <label>CFG Scale</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={20}
                                    step={0.5}
                                    value={novelaiScale}
                                    onChange={(e) => setNovelaiScale(parseFloat(e.target.value) || 6)}
                                    className="config-input"
                                />
                            </div>
                            <div className="form-field">
                                <label>Noise Schedule</label>
                                <select
                                    value={novelaiNoiseSchedule}
                                    onChange={(e) => setNovelaiNoiseSchedule(e.target.value)}
                                    className="config-select"
                                >
                                    {NOVELAI_NOISE_SCHEDULES.map((s) => (
                                        <option key={s} value={s}>
                                            {s}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>
                )}

                {/* Natural Style Preview */}
                {!isTagBased && selectedNaturalStyleId && getCurrentNaturalStyle() && (
                    <div className="style-preview-box">
                        <span className="preview-label">Style Preview:</span>
                        <span className="preview-text">
                            <span className="prefix">{getCurrentNaturalStyle()?.prefix}</span>
                            <em>[your prompt]</em>
                            <span className="postfix">{getCurrentNaturalStyle()?.postfix}</span>
                        </span>
                    </div>
                )}

                {/* Tag-Based Style Preview */}
                {isTagBased && selectedTagBasedStyleId && getCurrentTagBasedStyle() && (
                    <div className="style-preview-box tag-based">
                        <span className="preview-label">Style Tags:</span>
                        <div className="tag-preview-rows">
                            <div className="tag-row">
                                <span className="tag-indicator positive">+</span>
                                <span className="tag-text">
                                    {getCurrentTagBasedStyle()?.positiveTags || '(none)'}
                                </span>
                            </div>
                            <div className="tag-row">
                                <span className="tag-indicator negative">-</span>
                                <span className="tag-text">
                                    {getCurrentTagBasedStyle()?.negativeTags || '(none)'}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Error Display */}
                {error && <div className="error-message">{error}</div>}

                {/* Generate Button */}
                <div className="panel-actions">
                    <button
                        className="generate-button"
                        onClick={handleGenerate}
                        disabled={
                            isGenerating ||
                            (isTagBased ? !positivePrompt.trim() : !prompt.trim())
                        }
                    >
                        {isGenerating ? 'Generating...' : 'Generate Image'}
                    </button>
                </div>
            </div>

            {/* AI Prompt Builder Modal - only render when object context is available */}
            {showPromptBuilder && objectType && objectId && (
                <ImagePromptBuilderModal
                    isOpen={showPromptBuilder}
                    onClose={() => setShowPromptBuilder(false)}
                    onPromptGenerated={handlePromptBuilderGenerated}
                    objectType={objectType as 'character' | 'location' | 'organization' | 'lorebook'}
                    objectId={objectId}
                    promptMode={isTagBased ? activePromptTab : 'natural'}
                />
            )}
        </div>
    );
};

export default ImageGenerationPanel;

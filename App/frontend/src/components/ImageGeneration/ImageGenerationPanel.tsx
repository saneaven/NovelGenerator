import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import {
    useImageGeneration,
    PROVIDER_LABELS,
    MODEL_OPTIONS,
    SIZE_OPTIONS,
    GEMINI_ASPECT_RATIOS,
    GEMINI_RESOLUTIONS,
    NOVELAI_SAMPLERS,
    NOVELAI_NOISE_SCHEDULES,
    PROVIDER_PROMPT_TYPES,
    type ImageProviderType,
    type ImageGenerationRequest,
} from '../../imageGeneration';
import type { Asset } from '../../api/assetService';
import ImagePromptBuilderModal from './ImagePromptBuilderModal';
import './ImageGenerationPanel.css';

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
    objectType?: string;
    objectId?: string;
    initialSettings?: RegenerateSettings | null;
}

const ImageGenerationPanel: React.FC<ImageGenerationPanelProps> = ({
    onImageGenerated,
    onClose,
    objectType,
    objectId,
    initialSettings,
}) => {
    const { currentProjectId } = useProjectStore();
    const { settings } = useSettingsStore();
    const { objects, getObject } = useUnifiedObjectStore();

    // Use the new image generation hook
    const { generate, isGenerating, error } = useImageGeneration({
        taskType: 'object-image',
        onComplete: (result) => {
            if (result.asset && onImageGenerated) {
                // Transform to Asset format for callback
                const asset: Asset = {
                    id: result.asset.id,
                    project_id: result.asset.projectId,
                    name: result.asset.name,
                    file_path: result.asset.filePath,
                    thumbnail_path: result.asset.thumbnailPath,
                    mime_type: result.asset.mimeType,
                    asset_type: result.asset.assetType,
                    generation_prompt: result.asset.generationPrompt,
                    generation_positive_prompt: result.asset.generationPositivePrompt,
                    generation_negative_prompt: result.asset.generationNegativePrompt,
                    generation_provider: result.asset.generationProvider,
                    generation_model: result.asset.generationModel,
                    generation_settings: result.asset.generationSettings as Record<string, any> | null,
                    generation_reference_objects: null,
                    width: result.asset.width,
                    height: result.asset.height,
                    file_size: result.asset.fileSize,
                    created_at: result.asset.createdAt,
                    updated_at: result.asset.updatedAt,
                    file_url: result.asset.fileUrl,
                    thumbnail_url: result.asset.thumbnailUrl,
                };
                onImageGenerated(asset);
            }
        },
    });

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

    // Gemini-specific settings
    const [geminiAspectRatio, setGeminiAspectRatio] = useState(settings.imageGenConfig.geminiSettings.aspect_ratio);
    const [geminiResolution, setGeminiResolution] = useState(settings.imageGenConfig.geminiSettings.image_resolution);

    // Provider-specific settings
    const [openaiQuality, setOpenaiQuality] = useState<'standard' | 'hd'>(settings.imageGenConfig.openaiSettings.quality);
    const [openaiStyle, setOpenaiStyle] = useState<'natural' | 'vivid'>(settings.imageGenConfig.openaiSettings.style);
    const [novelaiSampler, setNovelaiSampler] = useState(settings.imageGenConfig.novelaiSettings.sampler);
    const [novelaiSteps, setNovelaiSteps] = useState(settings.imageGenConfig.novelaiSettings.steps);
    const [novelaiScale, setNovelaiScale] = useState(settings.imageGenConfig.novelaiSettings.scale);
    const [novelaiNoiseSchedule, setNovelaiNoiseSchedule] = useState(settings.imageGenConfig.novelaiSettings.noise_schedule);

    // Style selection
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

    // Apply initial settings when regenerating from asset detail
    useEffect(() => {
        if (!initialSettings) return;

        if (initialSettings.provider) {
            setProvider(initialSettings.provider as ImageProviderType);
        }
        if (initialSettings.model) {
            setModel(initialSettings.model);
        }
        if (initialSettings.prompt) {
            setPrompt(initialSettings.prompt);
        }
        if (initialSettings.positive_prompt) {
            setPositivePrompt(initialSettings.positive_prompt);
        }
        if (initialSettings.negative_prompt) {
            setNegativePrompt(initialSettings.negative_prompt);
        }
        if (initialSettings.size) {
            setSize(initialSettings.size);
        }

        if (initialSettings.settings) {
            const s = initialSettings.settings;
            if (s.quality) setOpenaiQuality(s.quality);
            if (s.style) setOpenaiStyle(s.style);
            if (s.sampler) setNovelaiSampler(s.sampler);
            if (s.steps) setNovelaiSteps(s.steps);
            if (s.scale) setNovelaiScale(s.scale);
            if (s.noise_schedule) setNovelaiNoiseSchedule(s.noise_schedule);
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

    // Reset model/size when provider changes
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

        if (isTagBased) {
            if (!positivePrompt.trim()) {
                alert('Please enter a positive prompt');
                return;
            }

            const request: ImageGenerationRequest = {
                positivePrompt: positivePrompt.trim(),
                negativePrompt: negativePrompt.trim() || undefined,
                provider,
                model,
                size,
                styleId: selectedTagBasedStyleId,
                sampler: novelaiSampler,
                steps: novelaiSteps,
                scale: novelaiScale,
                noiseSchedule: novelaiNoiseSchedule,
                // Asset type for story object images
                assetType: 'object',
            };

            await generate(request);
        } else {
            if (!prompt.trim()) {
                alert('Please enter a prompt');
                return;
            }

            const request: ImageGenerationRequest = {
                prompt: prompt.trim(),
                provider,
                model,
                size: provider === 'gemini' ? undefined : size,
                styleId: selectedNaturalStyleId,
                quality: provider === 'openai' ? openaiQuality : undefined,
                style: provider === 'openai' ? openaiStyle : undefined,
                aspectRatio: provider === 'gemini' ? geminiAspectRatio : undefined,
                resolution: provider === 'gemini' ? geminiResolution : undefined,
                // Asset type for story object images
                assetType: 'object',
            };

            await generate(request);
        }
    };

    const handlePromptBuilderGenerated = (generatedPrompt: string) => {
        if (isTagBased) {
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

            {/* AI Prompt Builder Modal */}
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

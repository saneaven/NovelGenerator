import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import {
    useImageGeneration,
    PROVIDER_LABELS,
    MODEL_OPTIONS,
    SIZE_OPTIONS,
    GEMINI_ASPECT_RATIOS,
    GEMINI_RESOLUTIONS,
    NOVELAI_SAMPLERS,
    NOVELAI_NOISE_SCHEDULES,
    NOVELAI_REFERENCE_MODES,
    DEFAULT_NOVELAI_SETTINGS,
    PROVIDER_PROMPT_TYPES,
    listImageProviders,
    type ImageProviderType,
    type ImageGenerationRequest,
    type ReferenceImage,
    type NovelAIReferenceMode,
} from '../../imageGeneration';
import type { Asset, ImageProvider } from '../../api/assetService';
import { UnifiedImageModal } from '../AssetManager';
import UnifiedImagePromptModal, { type PromptResult, type PromptMode } from './UnifiedImagePromptModal';
import ThinkingDisplay from '../ThinkingDisplay';
import { Check, AIAssistMini, Close } from '../icons';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import './ImageGenerationModal.css';

// Reference image item
interface ReferenceImageItem {
    assetId: string;
    thumbnailUrl: string;
}

// Settings passed from asset detail for regeneration
export interface RegenerateSettings {
    provider: string;
    model: string;
    prompt?: string;
    positive_prompt?: string;
    negative_prompt?: string;
    size?: string;
    settings?: Record<string, any>;
}

interface ImageGenerationModalProps {
    onImageGenerated?: (asset: Asset) => void;
    onClose?: () => void;
    objectType?: string;
    objectId?: string;
    manuscriptId?: string;  // For scene mode: ownership
    initialSettings?: RegenerateSettings | null;
    // Scene context for scene mode AI assist
    sceneContext?: { preContext: string; postContext: string };
    // Asset type for generated images ('object' or 'scene')
    assetType?: 'object' | 'scene';
}

const ImageGenerationModal: React.FC<ImageGenerationModalProps> = ({
    onImageGenerated,
    onClose,
    objectType,
    objectId,
    manuscriptId,
    initialSettings,
    sceneContext,
    assetType = 'object',
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
                    manuscript_id: null,  // Set by backend based on request
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

    // Streaming state for AI Assist
    const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
    const [streamingMode, setStreamingMode] = useState<PromptMode | null>(null);
    const [streamingError, setStreamingError] = useState<string | null>(null);

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

    // Reference images - available for all providers that support it
    const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>([]);
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [providers, setProviders] = useState<ImageProvider[]>([]);

    // NovelAI reference image settings (i2i / Vibe Transfer)
    const [novelaiReferenceMode, setNovelaiReferenceMode] = useState<NovelAIReferenceMode>(DEFAULT_NOVELAI_SETTINGS.referenceMode);
    const [novelaiStrength, setNovelaiStrength] = useState(DEFAULT_NOVELAI_SETTINGS.strength);
    const [novelaiI2iNoise, setNovelaiI2iNoise] = useState(DEFAULT_NOVELAI_SETTINGS.i2iNoise);
    const [novelaiVibeStrength, setNovelaiVibeStrength] = useState(DEFAULT_NOVELAI_SETTINGS.vibeStrength);
    const [novelaiVibeInfoExtracted, setNovelaiVibeInfoExtracted] = useState(DEFAULT_NOVELAI_SETTINGS.vibeInfoExtracted);

    const isInitialMount = useRef(true);
    const previousProvider = useRef(provider);

    // Load providers to check image input support
    useEffect(() => {
        listImageProviders().then(setProviders).catch(console.error);
    }, []);

    // Check if current provider supports image input
    const supportsImageInput = useMemo(() => {
        const currentProvider = providers.find(p => p.name === provider);
        return currentProvider?.supports_image_input ?? false;
    }, [providers, provider]);

    // Compute effective reference mode for NovelAI (auto mode resolves based on image count)
    const effectiveReferenceMode = useMemo(() => {
        if (novelaiReferenceMode === 'auto') {
            return referenceImages.length === 1 ? 'i2i' : 'vibe';
        }
        return novelaiReferenceMode;
    }, [novelaiReferenceMode, referenceImages.length]);

    // Check if we should show NovelAI reference settings
    const showNovelaiRefSettings = provider === 'novelai' && referenceImages.length > 0;

    // Add reference image handler
    const handleImageSelected = useCallback((assetId: string, thumbnailUrl: string) => {
        if (referenceImages.some(img => img.assetId === assetId)) {
            setShowImagePicker(false);
            return;
        }
        setReferenceImages(prev => [...prev, { assetId, thumbnailUrl }]);
        setShowImagePicker(false);
    }, [referenceImages]);

    // Remove reference image handler
    const handleRemoveImage = useCallback((assetId: string) => {
        setReferenceImages(prev => prev.filter(img => img.assetId !== assetId));
    }, []);

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
            if (typeof s.natural_style_id === 'string') setSelectedNaturalStyleId(s.natural_style_id);
            if (typeof s.tag_based_style_id === 'string') setSelectedTagBasedStyleId(s.tag_based_style_id);
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

    // Subscribe to streaming session from the store
    const streamingSession = useLLMTaskStore((state) =>
        streamingSessionId ? state.sessions[streamingSessionId] : undefined
    );

    // Effect to extract and update prompt during streaming
    useEffect(() => {
        if (!streamingSession || !streamingSessionId || !streamingMode) return;

        // Check for error status
        if (streamingSession.status === 'error') {
            setStreamingError(streamingSession.error || 'Failed to generate prompt');
            setStreamingSessionId(null);
            setStreamingMode(null);
            return;
        }

        // Extract prompt from contentParts (for native output mode)
        const textContent = streamingSession.contentParts
            ?.filter(p => p.type === 'content')
            .map(p => p.text)
            .join('') || '';

        // Extract prompt from functionCallProgress (for function call mode)
        const functionProgress = streamingSession.functionCallProgress?.[0];
        const parsedArgs = functionProgress?.draft?.parsedArguments;
        const functionPrompt = (parsedArgs as any)?.prompt || '';

        // Use whichever has content
        const streamingPrompt = functionPrompt || textContent;

        // Update the appropriate prompt field
        if (streamingPrompt) {
            switch (streamingMode) {
                case 'natural': setPrompt(streamingPrompt); break;
                case 'positive': setPositivePrompt(streamingPrompt); break;
                case 'negative': setNegativePrompt(streamingPrompt); break;
            }
        }

        // Clear streaming state when complete
        if (streamingSession.status !== 'running') {
            setStreamingSessionId(null);
            setStreamingMode(null);
        }
    }, [streamingSession, streamingSessionId, streamingMode]);

    // Handler for when streaming starts
    const handleStreamingStart = useCallback((sessionId: string, mode: PromptMode) => {
        setStreamingSessionId(sessionId);
        setStreamingMode(mode);
        setStreamingError(null);  // Clear previous error
        // Clear target prompt to show streaming from scratch
        switch (mode) {
            case 'natural': setPrompt(''); break;
            case 'positive': setPositivePrompt(''); break;
            case 'negative': setNegativePrompt(''); break;
        }
    }, []);

    // Handler for streaming errors (direct callback, no store subscription timing issues)
    const handleStreamingError = useCallback((error: string) => {
        setStreamingError(error);
        setStreamingSessionId(null);
        setStreamingMode(null);
    }, []);

    // Compute streaming states for UI
    const isStreamingNatural = streamingSessionId !== null && streamingMode === 'natural';
    const isStreamingPositive = streamingSessionId !== null && streamingMode === 'positive';
    const isStreamingNegative = streamingSessionId !== null && streamingMode === 'negative';
    const isStreaming = streamingSessionId !== null;

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

        // Build reference images data
        const referenceImagesData: ReferenceImage[] = supportsImageInput && referenceImages.length > 0
            ? referenceImages.map(img => ({ assetId: img.assetId, strength: 0.7 }))
            : [];

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
                // Reference images
                referenceImages: referenceImagesData.length > 0 ? referenceImagesData : undefined,
                // NovelAI reference settings
                referenceMode: provider === 'novelai' ? novelaiReferenceMode : undefined,
                strength: provider === 'novelai' ? novelaiStrength : undefined,
                i2iNoise: provider === 'novelai' ? novelaiI2iNoise : undefined,
                vibeStrength: provider === 'novelai' ? novelaiVibeStrength : undefined,
                vibeInfoExtracted: provider === 'novelai' ? novelaiVibeInfoExtracted : undefined,
                assetType,
                manuscriptId,
            };

            onClose?.();
            generate(request);
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
                // Reference images
                referenceImages: referenceImagesData.length > 0 ? referenceImagesData : undefined,
                assetType,
                manuscriptId,
            };

            onClose?.();
            generate(request);
        }
    };

    const handlePromptBuilderGenerated = (result: PromptResult) => {
        switch (result.mode) {
            case 'natural':
                setPrompt(result.prompt);
                break;
            case 'positive':
                setPositivePrompt(result.prompt);
                break;
            case 'negative':
                setNegativePrompt(result.prompt);
                break;
        }
    };

    const currentModelOptions = MODEL_OPTIONS[provider] || [];
    const currentSizeOptions = SIZE_OPTIONS[provider] || ['1024x1024'];

    return (
        <div className="image-generation-modal">
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
                        {/* Thinking display during streaming */}
                        {isStreamingNatural && streamingSession && (
                            <ThinkingDisplay
                                messageId={streamingSessionId!}
                                contentParts={streamingSession.contentParts}
                                displayMode="separate"
                                isStreaming={streamingSession.status === 'running'}
                            />
                        )}
                        <div className="prompt-input-wrapper">
                            <textarea
                                value={prompt}
                                onChange={(e) => !isStreamingNatural && setPrompt(e.target.value)}
                                placeholder="Describe the image you want to generate..."
                                rows={4}
                                className={`prompt-input ${isStreamingNatural ? 'streaming' : ''}`}
                                readOnly={isStreamingNatural}
                            />
                            <button
                                className="ai-assist-button"
                                onClick={() => setShowPromptBuilder(true)}
                                title="AI-assisted prompt generation"
                                type="button"
                                disabled={isStreaming}
                            >
                                <AIAssistMini size="sm" /> {isStreamingNatural ? 'Generating...' : 'AI Assist'}
                            </button>
                        </div>
                    </div>
                )}

                {/* Tag-Based Prompt Input with Tabs */}
                {isTagBased && (
                    <div className="form-field">
                        <label>Prompt</label>
                        {/* Thinking display during streaming */}
                        {(isStreamingPositive || isStreamingNegative) && streamingSession && (
                            <ThinkingDisplay
                                messageId={streamingSessionId!}
                                contentParts={streamingSession.contentParts}
                                displayMode="separate"
                                isStreaming={streamingSession.status === 'running'}
                            />
                        )}
                        <div className="prompt-tabs">
                            <button
                                className={`prompt-tab ${activePromptTab === 'positive' ? 'active' : ''}`}
                                onClick={() => setActivePromptTab('positive')}
                            >
                                Positive {positivePrompt && <Check size="xs" />}
                            </button>
                            <button
                                className={`prompt-tab ${activePromptTab === 'negative' ? 'active' : ''}`}
                                onClick={() => setActivePromptTab('negative')}
                            >
                                Negative {negativePrompt && <Check size="xs" />}
                            </button>
                        </div>
                        <div className="prompt-input-wrapper">
                            {activePromptTab === 'positive' ? (
                                <textarea
                                    value={positivePrompt}
                                    onChange={(e) => !isStreamingPositive && setPositivePrompt(e.target.value)}
                                    placeholder="1girl, solo, long hair, masterpiece, best quality, ..."
                                    rows={4}
                                    className={`prompt-input ${isStreamingPositive ? 'streaming' : ''}`}
                                    readOnly={isStreamingPositive}
                                />
                            ) : (
                                <textarea
                                    value={negativePrompt}
                                    onChange={(e) => !isStreamingNegative && setNegativePrompt(e.target.value)}
                                    placeholder="lowres, bad anatomy, bad hands, missing fingers, ..."
                                    rows={4}
                                    className={`prompt-input ${isStreamingNegative ? 'streaming' : ''}`}
                                    readOnly={isStreamingNegative}
                                />
                            )}
                            <button
                                className="ai-assist-button"
                                onClick={() => setShowPromptBuilder(true)}
                                title="AI-assisted prompt generation"
                                type="button"
                                disabled={isStreaming}
                            >
                                <AIAssistMini size="sm" /> {(isStreamingPositive || isStreamingNegative) ? 'Generating...' : 'AI Assist'}
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

                {/* Reference Images Section */}
                {supportsImageInput && (
                    <div className="form-section reference-images-section">
                        <div className="section-header">
                            <label>Reference Images</label>
                            <TextButton
                                variant="secondary"
                                size="sm"
                                onClick={() => setShowImagePicker(true)}
                            >
                                + Add
                            </TextButton>
                        </div>
                        {referenceImages.length === 0 ? (
                            <div className="empty-hint">
                                Add reference images for i2i or style transfer
                            </div>
                        ) : (
                            <div className="reference-images-grid">
                                {referenceImages.map(img => (
                                    <div key={img.assetId} className="reference-image-item">
                                        <img src={img.thumbnailUrl} alt="Reference" />
                                        <IconButton
                                            icon={<Close size="sm" />}
                                            onClick={() => handleRemoveImage(img.assetId)}
                                            title="Remove image"
                                            size="sm"
                                            className="remove-image-btn"
                                        />
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* NovelAI Reference Image Settings (i2i / Vibe Transfer) */}
                {showNovelaiRefSettings && (
                    <div className="novelai-ref-settings">
                        <div className="ref-settings-header">
                            <span className="ref-settings-label">Reference Image Mode</span>
                            {referenceImages.length > 4 && effectiveReferenceMode === 'vibe' && (
                                <span className="ref-warning">Extra Anlas cost for &gt;4 images</span>
                            )}
                        </div>
                        <div className="form-row">
                            <div className="form-field full-width">
                                <select
                                    value={novelaiReferenceMode}
                                    onChange={(e) => setNovelaiReferenceMode(e.target.value as NovelAIReferenceMode)}
                                    className="config-select"
                                >
                                    {NOVELAI_REFERENCE_MODES.map((m) => (
                                        <option key={m.value} value={m.value}>
                                            {m.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* i2i Settings */}
                        {effectiveReferenceMode === 'i2i' && (
                            <div className="form-row">
                                <div className="form-field">
                                    <label>Strength</label>
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={novelaiStrength}
                                        onChange={(e) => setNovelaiStrength(parseFloat(e.target.value))}
                                        className="config-slider"
                                    />
                                    <span className="slider-value">{novelaiStrength.toFixed(2)}</span>
                                </div>
                                <div className="form-field">
                                    <label>Noise</label>
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={novelaiI2iNoise}
                                        onChange={(e) => setNovelaiI2iNoise(parseFloat(e.target.value))}
                                        className="config-slider"
                                    />
                                    <span className="slider-value">{novelaiI2iNoise.toFixed(2)}</span>
                                </div>
                            </div>
                        )}

                        {/* Vibe Transfer Settings */}
                        {effectiveReferenceMode === 'vibe' && (
                            <div className="form-row">
                                <div className="form-field">
                                    <label>Style Influence</label>
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={novelaiVibeStrength}
                                        onChange={(e) => setNovelaiVibeStrength(parseFloat(e.target.value))}
                                        className="config-slider"
                                    />
                                    <span className="slider-value">{novelaiVibeStrength.toFixed(2)}</span>
                                </div>
                                <div className="form-field">
                                    <label>Info Extraction</label>
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={novelaiVibeInfoExtracted}
                                        onChange={(e) => setNovelaiVibeInfoExtracted(parseFloat(e.target.value))}
                                        className="config-slider"
                                    />
                                    <span className="slider-value">{novelaiVibeInfoExtracted.toFixed(2)}</span>
                                </div>
                            </div>
                        )}
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
	                                    {(() => {
	                                        const style = getCurrentTagBasedStyle();
	                                        const combined = [style?.positivePrefix, style?.positivePostfix]
	                                            .filter(Boolean)
	                                            .join(' ')
	                                            .trim();
	                                        return combined || '(none)';
	                                    })()}
	                                </span>
	                            </div>
	                            <div className="tag-row">
	                                <span className="tag-indicator negative">-</span>
	                                <span className="tag-text">
	                                    {(() => {
	                                        const style = getCurrentTagBasedStyle();
	                                        const combined = [style?.negativePrefix, style?.negativePostfix]
	                                            .filter(Boolean)
	                                            .join(' ')
	                                            .trim();
	                                        return combined || '(none)';
	                                    })()}
	                                </span>
	                            </div>
	                        </div>
	                    </div>
	                )}

                {/* Error Display */}
                {error && <div className="error-message">{error}</div>}
                {streamingError && <div className="error-message">{streamingError}</div>}

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

            {/* AI Prompt Builder Modal - supports object, cover_image, and scene contexts */}
            {showPromptBuilder && (objectType && objectId ? (
                objectType === 'basic_info' ? (
                    <UnifiedImagePromptModal
                        isOpen={showPromptBuilder}
                        onClose={() => setShowPromptBuilder(false)}
                        onPromptGenerated={handlePromptBuilderGenerated}
                        onStreamingStart={handleStreamingStart}
                        onStreamingError={handleStreamingError}
                        contextType="cover_image"
                        basicInfoId={objectId}
                        promptMode={isTagBased ? activePromptTab : 'natural'}
                    />
                ) : (
                    <UnifiedImagePromptModal
                        isOpen={showPromptBuilder}
                        onClose={() => setShowPromptBuilder(false)}
                        onPromptGenerated={handlePromptBuilderGenerated}
                        onStreamingStart={handleStreamingStart}
                        onStreamingError={handleStreamingError}
                        contextType="object"
                        objectType={objectType as 'character' | 'location' | 'organization' | 'lorebook'}
                        objectId={objectId}
                        promptMode={isTagBased ? activePromptTab : 'natural'}
                    />
                )
            ) : sceneContext ? (
                <UnifiedImagePromptModal
                    isOpen={showPromptBuilder}
                    onClose={() => setShowPromptBuilder(false)}
                    onPromptGenerated={handlePromptBuilderGenerated}
                    onStreamingStart={handleStreamingStart}
                    onStreamingError={handleStreamingError}
                    contextType="scene"
                    sceneContext={sceneContext}
                    promptMode={isTagBased ? activePromptTab : 'natural'}
                />
            ) : null)}

            {/* Reference Image Picker Modal */}
            {showImagePicker && (
                <UnifiedImageModal
                    preset="assetPicker"
                    isOpen={showImagePicker}
                    onClose={() => setShowImagePicker(false)}
                    onSelect={(asset: Asset) => handleImageSelected(asset.id, asset.thumbnail_url || asset.file_url || '')}
                    title="Select Reference Image"
                />
            )}
        </div>
    );
};

export default ImageGenerationModal;

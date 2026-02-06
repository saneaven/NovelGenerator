import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSettings } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import {
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
    type NovelAIReferenceMode,
    type ImageProviderType,
} from '../../imageTask/providerCatalog/providerConfig';
import { assetService, type Asset, type ImageProvider, type StyledPrompt } from '../../api/assetService';
import { getAssetUrl } from '../../utils/assetUrl';
import { ImageTaskRuntime, type GenerationRecipe, type ImageTaskBinding } from '../../imageTask';
import { useImageTaskStore } from '../../imageTask/store';
import { UnifiedImageModal } from '../AssetManager';
import UnifiedImagePromptModal, { type PromptResult, type PromptMode } from './UnifiedImagePromptModal';
import ThinkingDisplay from '../common/ThinkingDisplay';
import { AIAssistMini, Close } from '../icons';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import './ImageGenerationModal.css';

// Reference image item
interface ReferenceImageItem {
    assetId: string;
    previewUrl: string;
    strength: number;
    missing?: boolean;
}

interface ImageGenerationModalProps {
    onImageGenerated?: (asset: Asset) => void;
    onClose?: () => void;
    objectType?: string;
    objectId?: string;
    manuscriptId?: string;  // For scene mode: ownership
    initialRecipe?: GenerationRecipe | null; // Prefill UI for retry flow
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
    initialRecipe,
    sceneContext,
    assetType = 'object',
}) => {
    const { currentProjectId } = useProjectStore();
    const settings = useSettings();
    const { objects, getObject } = useUnifiedObjectStore();

    const [taskId, setTaskId] = useState<string | null>(null);
    const session = useImageTaskStore((state) => (taskId ? state.sessions[taskId] : undefined));
    const isGenerating = session?.status === 'running';
    const error = session?.status === 'error' ? session.error ?? 'Image generation failed' : null;
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

    // Provider-specific settings (serialized into recipe.providerSettings)
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

    const [customNaturalPrefix, setCustomNaturalPrefix] = useState('');
    const [customNaturalPostfix, setCustomNaturalPostfix] = useState('');
    const [customPositivePrefix, setCustomPositivePrefix] = useState('');
    const [customPositivePostfix, setCustomPositivePostfix] = useState('');
    const [customNegativePrefix, setCustomNegativePrefix] = useState('');
    const [customNegativePostfix, setCustomNegativePostfix] = useState('');

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

    // Preserve unknown providerSettings for retry/prefill.
    const [providerSettingsBase, setProviderSettingsBase] = useState<Record<string, any>>({});

    const isInitialMount = useRef(true);
    const previousProvider = useRef(provider);

    // Load providers to check image input support
    useEffect(() => {
        assetService.listImageProviders().then(setProviders).catch(console.error);
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
    const handleImageSelected = useCallback((assetId: string, previewUrl: string) => {
        if (referenceImages.some(img => img.assetId === assetId)) {
            setShowImagePicker(false);
            return;
        }
        setReferenceImages(prev => [...prev, { assetId, previewUrl, strength: 0.7 }]);
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

    // Prefill all settings from an existing recipe (Retry flow)
    useEffect(() => {
        if (!initialRecipe) return;

        previousProvider.current = initialRecipe.provider as ImageProviderType;

        setProvider(initialRecipe.provider as ImageProviderType);
        setModel(initialRecipe.model);
        if ('size' in initialRecipe && initialRecipe.size) setSize(initialRecipe.size);

        const s = (initialRecipe.providerSettings as Record<string, any> | undefined) ?? {};
        setProviderSettingsBase(s);

        // Provider-specific UI restoration from providerSettings
        if (s.quality === 'standard' || s.quality === 'hd') setOpenaiQuality(s.quality);
        if (s.style === 'natural' || s.style === 'vivid') setOpenaiStyle(s.style);
        if (typeof s.sampler === 'string') setNovelaiSampler(s.sampler);
        if (typeof s.steps === 'number') setNovelaiSteps(s.steps);
        if (typeof s.scale === 'number') setNovelaiScale(s.scale);
        if (typeof s.noise_schedule === 'string') setNovelaiNoiseSchedule(s.noise_schedule);
        if (typeof s.aspect_ratio === 'string') setGeminiAspectRatio(s.aspect_ratio);
        if (typeof s.image_resolution === 'string') setGeminiResolution(s.image_resolution);
        if (s.referenceMode === 'auto' || s.referenceMode === 'i2i' || s.referenceMode === 'vibe') {
            setNovelaiReferenceMode(s.referenceMode);
        }
        if (typeof s.strength === 'number') setNovelaiStrength(s.strength);
        if (typeof s.i2iNoise === 'number') setNovelaiI2iNoise(s.i2iNoise);
        if (typeof s.vibeStrength === 'number') setNovelaiVibeStrength(s.vibeStrength);
        if (typeof s.vibeInfoExtracted === 'number') setNovelaiVibeInfoExtracted(s.vibeInfoExtracted);

        // Prompts + style selection
        if (initialRecipe.promptType === 'natural') {
            setPrompt(initialRecipe.prompt.content ?? '');

            const desiredStyleId =
                initialRecipe.styleId && naturalStyles.some((style: any) => style.id === initialRecipe.styleId)
                    ? initialRecipe.styleId
                    : (naturalStyles.find(
                        (style: any) =>
                            (style.prefix || '') === (initialRecipe.prompt.prefix || '') &&
                            (style.postfix || '') === (initialRecipe.prompt.postfix || '')
                    )?.id ?? null);

            if (desiredStyleId) {
                setSelectedNaturalStyleId(desiredStyleId);
                setCustomNaturalPrefix('');
                setCustomNaturalPostfix('');
            } else {
                setSelectedNaturalStyleId(null);
                setCustomNaturalPrefix(initialRecipe.prompt.prefix || '');
                setCustomNaturalPostfix(initialRecipe.prompt.postfix || '');
            }

            setSelectedTagBasedStyleId(null);
            setCustomPositivePrefix('');
            setCustomPositivePostfix('');
            setCustomNegativePrefix('');
            setCustomNegativePostfix('');
        } else {
            setPositivePrompt(initialRecipe.positive.content ?? '');
            setNegativePrompt(initialRecipe.negative?.content ?? '');
            setActivePromptTab('positive');

            const neg = initialRecipe.negative ?? { prefix: '', content: '', postfix: '' };

            const desiredStyleId =
                initialRecipe.styleId && tagBasedStyles.some((style: any) => style.id === initialRecipe.styleId)
                    ? initialRecipe.styleId
                    : (tagBasedStyles.find(
                        (style: any) =>
                            (style.positivePrefix || '') === (initialRecipe.positive.prefix || '') &&
                            (style.positivePostfix || '') === (initialRecipe.positive.postfix || '') &&
                            (style.negativePrefix || '') === (neg.prefix || '') &&
                            (style.negativePostfix || '') === (neg.postfix || '')
                    )?.id ?? null);

            if (desiredStyleId) {
                setSelectedTagBasedStyleId(desiredStyleId);
                setCustomPositivePrefix('');
                setCustomPositivePostfix('');
                setCustomNegativePrefix('');
                setCustomNegativePostfix('');
            } else {
                setSelectedTagBasedStyleId(null);
                setCustomPositivePrefix(initialRecipe.positive.prefix || '');
                setCustomPositivePostfix(initialRecipe.positive.postfix || '');
                setCustomNegativePrefix(neg.prefix || '');
                setCustomNegativePostfix(neg.postfix || '');
            }

            setSelectedNaturalStyleId(null);
            setCustomNaturalPrefix('');
            setCustomNaturalPostfix('');
        }

        // Reference images: resolve thumbs by asset_id
        const refs = initialRecipe.referenceImages ?? [];
        if (!currentProjectId || refs.length === 0) {
            setReferenceImages([]);
            return;
        }

        setReferenceImages(
            refs.map((r) => ({
                assetId: r.assetId,
                strength: r.strength,
                previewUrl: '',
                missing: true,
            }))
        );

        let cancelled = false;
        void (async () => {
            const resolved = await Promise.all(
                refs.map(async (r) => {
                    try {
                        const a = await assetService.getAsset(currentProjectId, r.assetId);
                        const url = getAssetUrl(a);
                        return {
                            assetId: r.assetId,
                            strength: r.strength,
                            previewUrl: url || '',
                            missing: !url,
                        };
                    } catch {
                        return { assetId: r.assetId, strength: r.strength, previewUrl: '', missing: true };
                    }
                })
            );
            if (cancelled) return;
            setReferenceImages(resolved);
        })();

        return () => {
            cancelled = true;
        };
    }, [initialRecipe, currentProjectId, naturalStyles, tagBasedStyles]);

    // Auto-load saved prompts from object metadata
    useEffect(() => {
        if (!savedPrompts || initialRecipe) return;

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
    }, [objectId, provider, savedPrompts?.natural, savedPrompts?.positive, savedPrompts?.negative, initialRecipe]);

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
            setProviderSettingsBase({});
            setReferenceImages([]);
            setCustomNaturalPrefix('');
            setCustomNaturalPostfix('');
            setCustomPositivePrefix('');
            setCustomPositivePostfix('');
            setCustomNegativePrefix('');
            setCustomNegativePostfix('');
        }
    }, [provider]);

    // Subscribe to streaming session from the store
    const streamingSession = useLLMSessionStore((state) =>
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

        // Extract prompt from toolCallProgress (for tool call mode)
        const toolProgress = streamingSession.toolCallProgress?.[0];
        const parsedArgs = toolProgress?.draft?.parsedArguments;
        const toolPrompt = (parsedArgs as any)?.prompt || '';

        // Use whichever has content
        const streamingPrompt = toolPrompt || textContent;

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

    const binding: ImageTaskBinding | null = useMemo(() => {
        if (assetType === 'scene') {
            return manuscriptId ? { type: 'scene', manuscriptId } : null;
        }
        return objectType && objectId ? { type: 'object', objectType, objectId } : null;
    }, [assetType, manuscriptId, objectType, objectId]);

    const handleGenerate = async () => {
        if (!binding) {
            alert(
                assetType === 'scene'
                    ? 'Missing manuscriptId for scene image generation.'
                    : 'Missing object binding (objectType/objectId) for object image generation.'
            );
            return;
        }

        if (!currentProjectId) {
            alert('No project selected');
            return;
        }

        const referenceImagesData =
            supportsImageInput && referenceImages.length > 0
                ? referenceImages.map((img) => ({ assetId: img.assetId, strength: img.strength }))
                : undefined;

        let providerSettings: Record<string, unknown> | undefined =
            providerSettingsBase && Object.keys(providerSettingsBase).length > 0 ? { ...providerSettingsBase } : undefined;

        if (provider === 'openai') {
            providerSettings = { ...(providerSettings ?? {}), quality: openaiQuality, style: openaiStyle };
        } else if (provider === 'gemini') {
            providerSettings = { ...(providerSettings ?? {}), aspect_ratio: geminiAspectRatio, image_resolution: geminiResolution };
        } else if (provider === 'novelai') {
            providerSettings = {
                ...(providerSettings ?? {}),
                sampler: novelaiSampler,
                steps: novelaiSteps,
                scale: novelaiScale,
                noise_schedule: novelaiNoiseSchedule,
                referenceMode: novelaiReferenceMode,
                strength: novelaiStrength,
                i2iNoise: novelaiI2iNoise,
                vibeStrength: novelaiVibeStrength,
                vibeInfoExtracted: novelaiVibeInfoExtracted,
            };
        }

        if (isTagBased) {
            if (!positivePrompt.trim()) {
                alert('Please enter a positive prompt');
                return;
            }

            const style = getCurrentTagBasedStyle() as any;
            const positive: StyledPrompt = {
                prefix: (style?.positivePrefix ?? customPositivePrefix) || '',
                content: positivePrompt.trim(),
                postfix: (style?.positivePostfix ?? customPositivePostfix) || '',
            };

            const negPrefix = (style?.negativePrefix ?? customNegativePrefix) || '';
            const negPostfix = (style?.negativePostfix ?? customNegativePostfix) || '';
            const negContent = negativePrompt.trim();
            const negative: StyledPrompt | undefined =
                negContent || negPrefix || negPostfix
                    ? { prefix: negPrefix, content: negContent, postfix: negPostfix }
                    : undefined;

            const recipe: GenerationRecipe = {
                promptType: 'tag_based',
                provider,
                model,
                size,
                positive,
                negative,
                providerSettings,
                styleId: selectedTagBasedStyleId,
                referenceImages: referenceImagesData,
            };

                const { taskId: newTaskId } = ImageTaskRuntime.start(
                    { projectId: currentProjectId, binding, recipe, label: 'Generate image' },
                    {
                        onSuccess: (result) => {
                            onImageGenerated?.(result.asset);
                        },
                    }
                );
                setTaskId(newTaskId);
                onClose?.();
        } else {
            if (!prompt.trim()) {
                alert('Please enter a prompt');
                return;
            }

            const style = getCurrentNaturalStyle() as any;
            const promptObj: StyledPrompt = {
                prefix: (style?.prefix ?? customNaturalPrefix) || '',
                content: prompt.trim(),
                postfix: (style?.postfix ?? customNaturalPostfix) || '',
            };

            const recipe: GenerationRecipe = {
                promptType: 'natural',
                provider,
                model,
                size: provider === 'gemini' ? undefined : size,
                prompt: promptObj,
                providerSettings,
                styleId: selectedNaturalStyleId,
                referenceImages: referenceImagesData,
            };

            const { taskId: newTaskId } = ImageTaskRuntime.start(
                { projectId: currentProjectId, binding, recipe, label: 'Generate image' },
                {
                    onSuccess: (result) => {
                        onImageGenerated?.(result.asset);
                    },
                }
            );
            setTaskId(newTaskId);
            onClose?.();
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
                {/* Natural Language Prompt Input */}
                {!isTagBased && (
                    <div className="form-field">
                        <label>Prompt</label>
                        {/* Thinking display during streaming */}
                        {isStreamingNatural && streamingSession && (
                            <ThinkingDisplay
                                messageId={streamingSessionId!}
                                contentParts={streamingSession.contentParts}
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
                                isStreaming={streamingSession.status === 'running'}
                            />
                        )}
                        <div className="prompt-tabs">
                            <button
                                className={`prompt-tab ${activePromptTab === 'positive' ? 'active' : ''}`}
                                onClick={() => setActivePromptTab('positive')}
                            >
                                Positive
                            </button>
                            <button
                                className={`prompt-tab ${activePromptTab === 'negative' ? 'active' : ''}`}
                                onClick={() => setActivePromptTab('negative')}
                            >
                                Negative
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
                                        {img.previewUrl && !img.missing ? (
                                            <img src={img.previewUrl} alt="Reference" />
                                        ) : (
                                            <div className="reference-image-missing">Missing</div>
                                        )}
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
            </div>

            {/* Footer with Generate Button */}
            <div className="panel-footer">
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
                    onSelect={(asset: Asset) => {
                        handleImageSelected(asset.id, getAssetUrl(asset) || '');
                    }}
                    title="Select Reference Image"
                />
            )}
        </div>
    );
};

export default ImageGenerationModal;

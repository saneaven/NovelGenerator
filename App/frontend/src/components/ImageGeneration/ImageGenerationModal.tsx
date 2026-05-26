import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings, type ImageProviderType } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { assetService, type Asset, type StyledPrompt } from '../../api/assetService';
import { getAssetUrl } from '../../utils/assetUrl';
import type { ImageGenerationBinding, ImageGenerationRecipe } from '../../imageRun';
import { ImageRunRuntime, useImageRunStore } from '../../imageRun';
import {
    applyAspectRatioChange,
    applyImageSizeChange,
} from '../../imageRun/form/selection';
import { useImageGenerationForm } from '../../imageRun/form/useImageGenerationForm';
import {
    buildNaturalImageRecipe,
    buildTagBasedImageRecipe,
} from '../../imageRun/form/recipe';
import { UnifiedImageModal } from '../AssetManager';
import UnifiedImagePromptModal, { type PromptResult, type PromptMode } from './UnifiedImagePromptModal';
import ImageModelBrowser from './ImageModelBrowser';
import AuthenticatedImage from '../common/AuthenticatedImage';
import ThinkingDisplay from '../common/ThinkingDisplay';
import PreexistingLiveRunNotice from '../common/PreexistingLiveRunNotice';
import { useJourneyStore } from '../../store/journeyStore';
import { useThreadStore } from '../../store/threadStore';
import { useThreadLiveViewState } from '../../hooks/useThreadLiveViewState';
import { isPausedLikeThreadStatus } from '../../types/thread';
import { AIAssistMini, Close } from '../icons';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { alert as showAlert } from '../../store/dialogStore';
import type { StoryEntityKind } from '../../types/unifiedObject';
import ProviderSettingsFields from '../../providerEngine/ProviderSettingsFields';
import { buildImageProviderSettingsDraft } from '../../imageRun/form/providerSettings';
import './ImageGenerationModal.css';

// Reference image item
interface ReferenceImageItem {
    assetId: string;
    previewUrl: string;
    strength: number;
    missing?: boolean;
}

interface MaskImageItem {
    assetId: string;
    previewUrl: string;
    missing?: boolean;
}

function normalizeSelectedStyleId<T extends { id: string }>(styles: T[], styleId: string | null | undefined): string | null {
    if (!styleId) return null;
    return styles.some((style) => style.id === styleId) ? styleId : null;
}

interface ImageGenerationModalProps {
    onImageGenerated?: (asset: Asset) => void;
    onClose?: () => void;
    objectType?: string;
    objectId?: string;
    manuscriptId?: string;  // For scene mode: ownership
    initialRecipe?: ImageGenerationRecipe | null; // Prefill UI for retry flow
    // Scene context for scene mode AI assist
    sceneContext?: { preContext: string; postContext: string };
    // Asset type for generated images ('object' or 'scene')
    assetType?: 'object' | 'scene';
}

function readPromptValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function extractPromptTextFromData(data: Record<string, { contentParts?: Array<{ type: 'content'; text: string }> }>): string {
    const entry = Object.values(data)[0];
    if (!entry) return '';
    return (entry.contentParts ?? [])
        .filter((part) => part.type === 'content')
        .map((part) => part.text)
        .join('');
}

function extractFinalPromptFromThread(threadId: string): string {
    const store = useThreadStore.getState();
    const messages = store.getMessages(threadId);
    const lastAssistantMsg = [...messages].reverse().find((message) => message.role === 'assistant');
    if (!lastAssistantMsg) return '';

    const finalText = extractPromptTextFromData(lastAssistantMsg.data);
    if (finalText) return finalText;

    const toolCalls = store.getToolCallsForAssistantMessage(lastAssistantMsg.id);
    for (const toolCall of toolCalls) {
        const promptFromArguments = readPromptValue((toolCall.arguments as Record<string, unknown> | undefined)?.prompt);
        if (promptFromArguments) return promptFromArguments;
        const promptFromResult = readPromptValue((toolCall.result as Record<string, unknown> | null | undefined)?.prompt);
        if (promptFromResult) return promptFromResult;
    }

    return '';
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
    const { t } = useTranslation();
    const { currentProjectId } = useProjectStore();
    const settings = useSettings();
    const { getObject } = useUnifiedObjectStore();
    const [provider, setProvider] = useState<ImageProviderType>(settings.imageGenConfig.provider);
    const [model, setModel] = useState(settings.imageGenConfig.model);
    const [aspectRatio, setAspectRatio] = useState(settings.imageGenConfig.aspect_ratio);
    const [imageSize, setImageSize] = useState(settings.imageGenConfig.image_size);

    const [taskId, setTaskId] = useState<string | null>(null);
    const session = useImageRunStore((state) => (taskId ? state.runsById[taskId] : undefined));
    const isGenerating = session?.status === 'queued' || session?.status === 'running' || session?.status === 'applying';
    const error = session?.status === 'failed' ? session.error_message ?? 'Image generation failed' : null;
    // Get saved prompts from object metadata
    const savedPromptObject = objectId ? getObject(objectId) : null;
    const savedPrompts = useMemo(() => {
        if (!savedPromptObject?.metadata) return null;
        return {
            natural: savedPromptObject.metadata.image_prompt || '',
            positive: savedPromptObject.metadata.image_prompt_positive || '',
            negative: savedPromptObject.metadata.image_prompt_negative || '',
        };
    }, [savedPromptObject]);
    const objectKind = savedPromptObject?.type === 'story_entity' ? savedPromptObject.kind : undefined;

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
    const previousStreamingStatusRef = useRef<'running' | 'done' | 'halted' | null>(null);
    const [providerSettingsDraft, setProviderSettingsDraft] = useState<Record<string, unknown>>({});

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
    const [maskImage, setMaskImage] = useState<MaskImageItem | null>(null);
    const [assetPickerMode, setAssetPickerMode] = useState<'reference' | 'mask' | null>(null);
    const {
        providerSpecs,
        providerSpec,
        imageProviders,
        models,
        loading: modelsLoading,
        error: modelError,
        selectedModel,
        currentPromptType,
        isTagBased,
        providerSettingsSpec,
        normalizedProviderSettings,
        providerSettingsFlags,
        supportsImageInput,
        supportsMaskInput,
        isNativeExact,
        supportedImageSizes,
        generationBlocker,
        reconciledSelection,
    } = useImageGenerationForm({
        provider,
        model,
        aspectRatio,
        imageSize,
        providerSettingsDraft,
        referenceImageCount: referenceImages.length,
        hasMaskImage: Boolean(maskImage),
    });

    const isInitialMount = useRef(true);
    const previousProvider = useRef(provider);
    const seededProviderSettings = useRef<string | null>(null);
    const buildProviderSettingsDraft = useCallback((
        providerId: string,
        recipe?: ImageGenerationRecipe | null,
    ): Record<string, unknown> => {
        return buildImageProviderSettingsDraft(
            providerId,
            providerSpecs,
            settings.imageGenConfig as Record<string, unknown>,
            recipe,
        );
    }, [providerSpecs, settings.imageGenConfig]);
    const showReferenceSection = supportsImageInput || referenceImages.length > 0 || Boolean(maskImage);
    const showMaskSection = supportsMaskInput || Boolean(maskImage);

    // Add reference image handler
    const handleImageSelected = useCallback((assetId: string, previewUrl: string) => {
        if (assetPickerMode === 'mask') {
            setMaskImage({ assetId, previewUrl, missing: !previewUrl });
            setAssetPickerMode(null);
            return;
        }
        if (referenceImages.some(img => img.assetId === assetId)) {
            setAssetPickerMode(null);
            return;
        }
        setReferenceImages(prev => [...prev, { assetId, previewUrl, strength: 0.7 }]);
        setAssetPickerMode(null);
    }, [assetPickerMode, referenceImages]);

    // Remove reference image handler
    const handleRemoveImage = useCallback((assetId: string) => {
        setReferenceImages(prev => prev.filter(img => img.assetId !== assetId));
    }, []);

    const handleRemoveMaskImage = useCallback(() => {
        setMaskImage(null);
    }, []);

    const providerOptions = useMemo(
        () => imageProviders.map((item) => ({
            value: item.id,
            label: t(item.ui.display_name_key),
        })),
        [imageProviders, t]
    );

    const naturalStyles = useMemo(
        () => settings.imageGenConfig.naturalStyles ?? [],
        [settings.imageGenConfig.naturalStyles],
    );
    const tagBasedStyles = useMemo(
        () => settings.imageGenConfig.tagBasedStyles ?? [],
        [settings.imageGenConfig.tagBasedStyles],
    );

    // Prefill all settings from an existing recipe (Retry flow)
    useEffect(() => {
        if (!initialRecipe) return;

        previousProvider.current = initialRecipe.provider as ImageProviderType;
        seededProviderSettings.current = initialRecipe.provider as ImageProviderType;

        setProvider(initialRecipe.provider as ImageProviderType);
        setModel(initialRecipe.model);
        setAspectRatio(initialRecipe.aspectRatio);
        setImageSize(initialRecipe.imageSize);
        setProviderSettingsDraft(buildProviderSettingsDraft(initialRecipe.provider, initialRecipe));

        if (initialRecipe.promptType === 'natural') {
            setSelectedNaturalStyleId(normalizeSelectedStyleId(naturalStyles, initialRecipe.styleId));
            setSelectedTagBasedStyleId(null);
            setCustomNaturalPrefix('');
            setCustomNaturalPostfix('');
            setCustomPositivePrefix('');
            setCustomPositivePostfix('');
            setCustomNegativePrefix('');
            setCustomNegativePostfix('');
            setPrompt(initialRecipe.prompt.content ?? '');
        } else {
            setSelectedTagBasedStyleId(normalizeSelectedStyleId(tagBasedStyles, initialRecipe.styleId));
            setSelectedNaturalStyleId(null);
            setCustomNaturalPrefix('');
            setCustomNaturalPostfix('');
            setCustomPositivePrefix('');
            setCustomPositivePostfix('');
            setCustomNegativePrefix('');
            setCustomNegativePostfix('');
            setPositivePrompt(initialRecipe.positive.content ?? '');
            setNegativePrompt(initialRecipe.negative?.content ?? '');
            setActivePromptTab('positive');
        }

        // Reference images: resolve thumbs by asset_id
        const refs = initialRecipe.referenceImages ?? [];
        const mask = initialRecipe.maskImage ?? null;

        if (!currentProjectId) {
            setReferenceImages([]);
            setMaskImage(mask ? { assetId: mask.assetId, previewUrl: '', missing: true } : null);
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
        setMaskImage(mask ? { assetId: mask.assetId, previewUrl: '', missing: true } : null);

        if (refs.length === 0 && !mask) {
            return;
        }

        let cancelled = false;
        void (async () => {
            const [resolvedRefs, resolvedMask] = await Promise.all([
                Promise.all(
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
                ),
                mask ? (async () => {
                    try {
                        const a = await assetService.getAsset(currentProjectId, mask.assetId);
                        const url = getAssetUrl(a);
                        return { assetId: mask.assetId, previewUrl: url || '', missing: !url };
                    } catch {
                        return { assetId: mask.assetId, previewUrl: '', missing: true };
                    }
                })() : Promise.resolve<MaskImageItem | null>(null),
            ]);
            if (cancelled) return;
            setReferenceImages(resolvedRefs);
            setMaskImage(resolvedMask);
        })();

        return () => {
            cancelled = true;
        };
    }, [initialRecipe, currentProjectId, naturalStyles, tagBasedStyles, buildProviderSettingsDraft]);

    useEffect(() => {
        if (!selectedNaturalStyleId) return;
        if (naturalStyles.some((style) => style.id === selectedNaturalStyleId)) return;
        setSelectedNaturalStyleId(null);
    }, [selectedNaturalStyleId, naturalStyles]);

    useEffect(() => {
        if (!selectedTagBasedStyleId) return;
        if (tagBasedStyles.some((style) => style.id === selectedTagBasedStyleId)) return;
        setSelectedTagBasedStyleId(null);
    }, [selectedTagBasedStyleId, tagBasedStyles]);

    useEffect(() => {
        if (!providerSettingsSpec) return;
        if (seededProviderSettings.current === provider) return;
        seededProviderSettings.current = provider;
        setProviderSettingsDraft(buildProviderSettingsDraft(provider, initialRecipe));
    }, [provider, providerSettingsSpec, buildProviderSettingsDraft, initialRecipe]);

    // Auto-load saved prompts from object metadata
    useEffect(() => {
        if (!savedPrompts || initialRecipe) return;

        const promptType = currentPromptType;
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
    }, [currentPromptType, savedPrompts, initialRecipe]);

    // Reset model/size when provider changes
    useEffect(() => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        if (previousProvider.current !== provider) {
            previousProvider.current = provider;
            seededProviderSettings.current = null;
            setModel('');
            setProviderSettingsDraft(buildProviderSettingsDraft(provider, null));
            setReferenceImages([]);
            setMaskImage(null);
            setCustomNaturalPrefix('');
            setCustomNaturalPostfix('');
            setCustomPositivePrefix('');
            setCustomPositivePostfix('');
            setCustomNegativePrefix('');
            setCustomNegativePostfix('');
        }
    }, [provider, buildProviderSettingsDraft]);

    useEffect(() => {
        if (reconciledSelection.model !== model) setModel(reconciledSelection.model);
        if (reconciledSelection.aspectRatio !== aspectRatio) setAspectRatio(reconciledSelection.aspectRatio);
        if (reconciledSelection.imageSize !== imageSize) setImageSize(reconciledSelection.imageSize);
    }, [reconciledSelection, model, aspectRatio, imageSize]);

    const journeyThreadId = useJourneyStore((state) =>
        streamingSessionId ? state.journeys[streamingSessionId]?.threadId : undefined
    );
    const streamingThreadStatus = useThreadStore((state) =>
        journeyThreadId ? state.threadsById[journeyThreadId]?.status : undefined
    );
    const streamingThreadError = useThreadStore((state) =>
        journeyThreadId ? state.threadsById[journeyThreadId]?.lastError : undefined
    );
    const liveView = useThreadLiveViewState(journeyThreadId ?? null);
    const streamingStatus = useMemo(() => {
        if (!streamingSessionId) return null;
        return isPausedLikeThreadStatus(streamingThreadStatus)
            ? 'halted'
            : (streamingThreadStatus === 'done' || streamingThreadStatus === 'canceled')
                ? 'done'
                : 'running';
    }, [streamingSessionId, streamingThreadStatus]);
    const streamingDeliveryMode = liveView?.deliveryMode ?? 'live';
    const streamingReasoningDetail = liveView?.reasoningDetail;
    const streamedText = useMemo(
        () => (liveView?.contentParts ?? []).map((part) => part.text).join(''),
        [liveView?.contentParts],
    );
    const streamedToolPrompt = useMemo(() => {
        const firstToolCall = liveView?.streamingToolCalls[0];
        return readPromptValue((firstToolCall?.arguments as Record<string, unknown> | undefined)?.prompt);
    }, [liveView?.streamingToolCalls]);
    const effectivePrompt = useMemo(
        () => streamedToolPrompt || streamedText,
        [streamedToolPrompt, streamedText],
    );
    const streamThreadId = journeyThreadId ?? null;
    const streamingErrorMessage = streamingStatus === 'halted'
        ? (
            streamingThreadStatus === 'paused'
                ? 'Prompt generation paused.'
                : (streamingThreadError ?? 'Failed to generate prompt')
        )
        : null;
    const isSuppressedStreaming = streamingStatus === 'running' && streamingDeliveryMode === 'suppressed';
    const isStreamingRunning = streamingStatus === 'running';

    const applyPromptForMode = useCallback((mode: PromptMode, nextPrompt: string) => {
        switch (mode) {
            case 'natural':
                setPrompt((prev) => (prev === nextPrompt ? prev : nextPrompt));
                break;
            case 'positive':
                setPositivePrompt((prev) => (prev === nextPrompt ? prev : nextPrompt));
                break;
            case 'negative':
                setNegativePrompt((prev) => (prev === nextPrompt ? prev : nextPrompt));
                break;
        }
    }, []);

    // Reflect incremental streaming updates without re-setting identical prompt text.
    useEffect(() => {
        if (!streamingSessionId || !streamingMode) return;
        if (streamingStatus !== 'running') return;
        if (!effectivePrompt) return;
        applyPromptForMode(streamingMode, effectivePrompt);
    }, [streamingSessionId, streamingMode, streamingStatus, effectivePrompt, applyPromptForMode]);

    // Finalize or fail the streaming session exactly once per terminal transition.
    useEffect(() => {
        if (!streamingSessionId || !streamingMode || !streamingStatus) {
            previousStreamingStatusRef.current = null;
            return;
        }

        if (streamingStatus === 'running') {
            previousStreamingStatusRef.current = 'running';
            return;
        }

        if (previousStreamingStatusRef.current === streamingStatus) return;
        previousStreamingStatusRef.current = streamingStatus;

        if (streamingStatus === 'halted') {
            setStreamingError(streamingErrorMessage ?? 'Failed to generate prompt');
            setStreamingSessionId(null);
            setStreamingMode(null);
            return;
        }

        if (streamThreadId) {
            const finalPrompt = extractFinalPromptFromThread(streamThreadId);
            if (finalPrompt) {
                applyPromptForMode(streamingMode, finalPrompt);
            }
        }

        setStreamingSessionId(null);
        setStreamingMode(null);
    }, [
        streamingSessionId,
        streamingMode,
        streamingStatus,
        streamingErrorMessage,
        streamThreadId,
        applyPromptForMode,
    ]);

    // Handler for when streaming starts
    const handleStreamingStart = useCallback((sessionId: string, mode: PromptMode) => {
        previousStreamingStatusRef.current = null;
        setStreamingSessionId(sessionId);
        setStreamingMode(mode);
        setStreamingError(null);  // Clear previous error
        // Clear target prompt to show streaming from scratch
        applyPromptForMode(mode, '');
    }, [applyPromptForMode]);

    // Handler for streaming errors (direct callback, no store subscription timing issues)
    const handleStreamingError = useCallback((error: string) => {
        previousStreamingStatusRef.current = null;
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

    const binding: ImageGenerationBinding | null = useMemo(() => {
        if (assetType === 'scene') {
            return manuscriptId ? { type: 'scene', manuscriptId } : null;
        }
        return objectType && objectId ? { type: 'object', objectType, objectId } : null;
    }, [assetType, manuscriptId, objectType, objectId]);

    const handleGenerate = async () => {
        if (!binding) {
            showAlert({
                title: 'Validation Error',
                message: assetType === 'scene'
                    ? 'Missing manuscriptId for scene image generation.'
                    : 'Missing object binding (objectType/objectId) for object image generation.',
            });
            return;
        }

        if (!currentProjectId) {
            showAlert({ title: 'Validation Error', message: 'No project selected' });
            return;
        }
        if (!selectedModel) {
            showAlert({ title: 'Validation Error', message: 'No image model is available for the selected provider.' });
            return;
        }
        if (generationBlocker) {
            showAlert({ title: 'Validation Error', message: generationBlocker });
            return;
        }

        const referenceImagesData =
            supportsImageInput && referenceImages.length > 0
                ? referenceImages.map((img) => ({
                    assetId: img.assetId,
                    strength: img.strength,
                }))
                : undefined;
        const maskImageData = maskImage ? { assetId: maskImage.assetId } : undefined;

        const providerSettings =
            Object.keys(normalizedProviderSettings).length > 0
                ? normalizedProviderSettings
                : undefined;

        if (isTagBased) {
            if (!positivePrompt.trim()) {
                showAlert({ title: 'Missing Prompt', message: 'Please enter a positive prompt' });
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

            const recipe: ImageGenerationRecipe = buildTagBasedImageRecipe({
                provider,
                model,
                aspectRatio,
                imageSize,
                positive,
                negative,
                providerSettings,
                styleId: selectedTagBasedStyleId,
                referenceImages: referenceImagesData,
                maskImage: maskImageData,
            });

                const { imageRunId: newTaskId } = await ImageRunRuntime.start(
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
                showAlert({ title: 'Missing Prompt', message: 'Please enter a prompt' });
                return;
            }

            const style = getCurrentNaturalStyle() as any;
            const promptObj: StyledPrompt = {
                prefix: (style?.prefix ?? customNaturalPrefix) || '',
                content: prompt.trim(),
                postfix: (style?.postfix ?? customNaturalPostfix) || '',
            };

            const recipe: ImageGenerationRecipe = buildNaturalImageRecipe({
                provider,
                model,
                aspectRatio,
                imageSize,
                prompt: promptObj,
                providerSettings,
                styleId: selectedNaturalStyleId,
                referenceImages: referenceImagesData,
                maskImage: maskImageData,
            });

            const { imageRunId: newTaskId } = await ImageRunRuntime.start(
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
        applyPromptForMode(result.mode, result.prompt);
    };

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
                        {isStreamingNatural && streamingStatus && (
                            isSuppressedStreaming ? (
                                <PreexistingLiveRunNotice />
                            ) : (
                                <ThinkingDisplay
                                    messageId={streamingSessionId!}
                                    reasoningDetail={streamingReasoningDetail}
                                    isStreaming={isStreamingRunning}
                                />
                            )
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
                        {(isStreamingPositive || isStreamingNegative) && streamingStatus && (
                            isSuppressedStreaming ? (
                                <PreexistingLiveRunNotice />
                            ) : (
                                <ThinkingDisplay
                                    messageId={streamingSessionId!}
                                    reasoningDetail={streamingReasoningDetail}
                                    isStreaming={isStreamingRunning}
                                />
                            )
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
                            {providerOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className="form-field">
                        <label>Model</label>
                        <ImageModelBrowser
                            provider={provider}
                            models={models}
                            currentModel={model}
                            onSelectModel={setModel}
                            loading={modelsLoading}
                            error={modelError}
                        />
                    </div>
                </div>

                {/* Geometry and Style Selection */}
                <div className="form-row">
                    {!isNativeExact ? (
                        <>
                            <div className="form-field">
                                <label>Aspect Ratio</label>
                                <select
                                    value={aspectRatio}
                                    onChange={(e) => {
                                        const nextSelection = applyAspectRatioChange(
                                            selectedModel,
                                            { model, aspectRatio, imageSize },
                                            e.target.value,
                                        );
                                        setAspectRatio(nextSelection.aspectRatio);
                                        setImageSize(nextSelection.imageSize);
                                    }}
                                    className="config-select"
                                    disabled={!selectedModel || selectedModel.supported_aspect_ratios.length <= 1}
                                >
                                    {(selectedModel?.supported_aspect_ratios ?? [aspectRatio]).map((ratio) => (
                                        <option key={ratio} value={ratio}>
                                            {ratio}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Image Size</label>
                                <select
                                    value={imageSize}
                                    onChange={(e) => {
                                        const nextSelection = applyImageSizeChange(
                                            selectedModel,
                                            { model, aspectRatio, imageSize },
                                            e.target.value,
                                        );
                                        setAspectRatio(nextSelection.aspectRatio);
                                        setImageSize(nextSelection.imageSize);
                                    }}
                                    className="config-select"
                                    disabled={!selectedModel || supportedImageSizes.length <= 1}
                                >
                                    {(supportedImageSizes.length > 0 ? supportedImageSizes : [imageSize]).map((sizeOption) => (
                                        <option key={sizeOption} value={sizeOption}>
                                            {sizeOption}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="form-field">
                                <label>Output Size</label>
                                <select
                                    value={imageSize}
                                    onChange={(e) => {
                                        const nextSelection = applyImageSizeChange(
                                            selectedModel,
                                            { model, aspectRatio, imageSize },
                                            e.target.value,
                                        );
                                        setImageSize(nextSelection.imageSize);
                                        setAspectRatio(nextSelection.aspectRatio);
                                    }}
                                    className="config-select"
                                    disabled={!selectedModel || selectedModel.supported_image_sizes.length <= 1}
                                >
                                    {(selectedModel?.supported_image_sizes ?? [imageSize]).map((sizeOption) => (
                                        <option key={sizeOption} value={sizeOption}>
                                            {sizeOption}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-field">
                                <label>Aspect Ratio</label>
                                <input
                                    type="text"
                                    value={aspectRatio}
                                    className="config-input"
                                    disabled
                                />
                            </div>
                        </>
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

                {providerSettingsSpec ? (
                    <div className="provider-settings">
                        <div className="provider-settings-header">
                            <label>{t(providerSpec?.image?.settings_title_key || providerSpec?.ui.display_name_key || 'settings.imageGen.provider')}</label>
                            {providerSpec?.image?.settings_description_key ? (
                                <p className="provider-settings-description">{t(providerSpec.image.settings_description_key)}</p>
                            ) : null}
                        </div>
                        <ProviderSettingsFields
                            spec={providerSettingsSpec}
                            draft={providerSettingsDraft}
                            setDraft={setProviderSettingsDraft}
                            className="image-generation-provider-settings"
                            flags={providerSettingsFlags}
                        />
                    </div>
                ) : null}

                {/* Reference Images Section */}
                {showReferenceSection && (
                    <div className="form-section reference-images-section">
                        <div className="section-header">
                            <label>Reference Images</label>
                            <TextButton
                                variant="secondary"
                                size="sm"
                                onClick={() => setAssetPickerMode('reference')}
                                disabled={!supportsImageInput}
                            >
                                + Add
                            </TextButton>
                        </div>
                        {!supportsImageInput ? (
                            <div className="empty-hint">
                                The selected model does not support image input. Remove the existing reference images or switch models.
                            </div>
                        ) : null}
                        {referenceImages.length === 0 ? (
                            <div className="empty-hint">
                                Add reference images for i2i or style transfer
                            </div>
                        ) : (
                            <div className="reference-images-grid">
                                {referenceImages.map(img => (
                                    <div key={img.assetId} className="reference-image-item">
                                        {img.previewUrl && !img.missing ? (
                                            <AuthenticatedImage src={img.previewUrl} alt="Reference" />
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

                {showMaskSection ? (
                    <div className="form-section reference-images-section">
                        <div className="section-header">
                            <label>Mask</label>
                            <TextButton
                                variant="secondary"
                                size="sm"
                                onClick={() => setAssetPickerMode('mask')}
                                disabled={!supportsMaskInput}
                            >
                                {maskImage ? 'Replace' : 'Add'}
                            </TextButton>
                        </div>
                        {!supportsMaskInput ? (
                            <div className="empty-hint">
                                The selected model does not support mask input. Remove the existing mask or switch models.
                            </div>
                        ) : null}
                        {!maskImage ? (
                            <div className="empty-hint">
                                Add a mask image for inpainting.
                            </div>
                        ) : (
                            <div className="reference-images-grid">
                                <div className="reference-image-item">
                                    {maskImage.previewUrl && !maskImage.missing ? (
                                        <AuthenticatedImage src={maskImage.previewUrl} alt="Mask" />
                                    ) : (
                                        <div className="reference-image-missing">Missing</div>
                                    )}
                                    <IconButton
                                        icon={<Close size="sm" />}
                                        onClick={handleRemoveMaskImage}
                                        title="Remove mask"
                                        size="sm"
                                        className="remove-image-btn"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                ) : null}

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
                {generationBlocker && <div className="error-message">{generationBlocker}</div>}
            </div>

            {/* Footer with Generate Button */}
            <div className="panel-footer">
                <button
                    className="generate-button"
                    onClick={handleGenerate}
                    disabled={
                        isGenerating ||
                        Boolean(generationBlocker) ||
                        (isTagBased ? !positivePrompt.trim() : !prompt.trim())
                    }
                >
                    {isGenerating ? 'Generating...' : 'Generate Image'}
                </button>
            </div>

            {/* AI Prompt Builder Modal - supports object and scene contexts */}
            {showPromptBuilder && (objectType && objectId ? (
                <UnifiedImagePromptModal
                    isOpen={showPromptBuilder}
                    onClose={() => setShowPromptBuilder(false)}
                    onPromptGenerated={handlePromptBuilderGenerated}
                    onStreamingStart={handleStreamingStart}
                    onStreamingError={handleStreamingError}
                    contextType="object"
                    objectType={objectType as 'basic_info' | 'story_entity'}
                    objectKind={objectKind as StoryEntityKind | undefined}
                    objectId={objectId}
                    promptMode={isTagBased ? activePromptTab : 'natural'}
                />
            ) : sceneContext ? (
                <UnifiedImagePromptModal
                    isOpen={showPromptBuilder}
                    onClose={() => setShowPromptBuilder(false)}
                    onPromptGenerated={handlePromptBuilderGenerated}
                    onStreamingStart={handleStreamingStart}
                    onStreamingError={handleStreamingError}
                    contextType="scene"
                    manuscriptId={manuscriptId}
                    sceneContext={sceneContext}
                    promptMode={isTagBased ? activePromptTab : 'natural'}
                />
            ) : null)}

            {/* Reference Image Picker Modal */}
            {assetPickerMode && (
                <UnifiedImageModal
                    preset="assetPicker"
                    isOpen={assetPickerMode !== null}
                    onClose={() => setAssetPickerMode(null)}
                    onSelect={(asset: Asset) => {
                        handleImageSelected(asset.id, asset.file_url || '');
                    }}
                    title={assetPickerMode === 'mask' ? 'Select Mask Image' : 'Select Reference Image'}
                />
            )}
        </div>
    );
};

export default ImageGenerationModal;

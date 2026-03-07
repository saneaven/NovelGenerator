import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useSettings } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
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
} from '../../imageRun/providerConfig';
import { assetService, type Asset, type ImageProvider, type StyledPrompt } from '../../api/assetService';
import { getAssetUrl } from '../../utils/assetUrl';
import type { ImageGenerationBinding, ImageGenerationRecipe } from '../../imageRun';
import { ImageRunRuntime, useImageRunStore } from '../../imageRun';
import { UnifiedImageModal } from '../AssetManager';
import UnifiedImagePromptModal, { type PromptResult, type PromptMode } from './UnifiedImagePromptModal';
import ThinkingDisplay from '../common/ThinkingDisplay';
import PreexistingLiveRunNotice from '../common/PreexistingLiveRunNotice';
import { useJourneyStore } from '../../store/journeyStore';
import { useThreadStore } from '../../store/threadStore';
import { useThreadLiveViewState } from '../../hooks/useThreadLiveViewState';
import { AIAssistMini, Close } from '../icons';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { alert as showAlert } from '../../store/dialogStore';
import { NumberInput } from '../ui/NumberInput';
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
    const { currentProjectId } = useProjectStore();
    const settings = useSettings();
    const { getObject } = useUnifiedObjectStore();

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
    const previousStreamingStatusRef = useRef<'running' | 'done' | 'error' | null>(null);

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
    }, [provider, savedPrompts, initialRecipe]);

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
        return streamingThreadStatus === 'error'
            ? 'error'
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
    const streamingErrorMessage = streamingStatus === 'error'
        ? (streamingThreadError ?? 'Failed to generate prompt')
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

        if (streamingStatus === 'error') {
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

            const recipe: ImageGenerationRecipe = {
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

            const recipe: ImageGenerationRecipe = {
                promptType: 'natural',
                provider,
                model,
                size: provider === 'gemini' ? undefined : size,
                prompt: promptObj,
                providerSettings,
                styleId: selectedNaturalStyleId,
                referenceImages: referenceImagesData,
            };

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
                        {isStreamingNatural && streamingStatus && (
                            isSuppressedStreaming ? (
                                <PreexistingLiveRunNotice compact />
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
                                <PreexistingLiveRunNotice compact />
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
                                <NumberInput
                                    min={1}
                                    max={50}
                                    value={novelaiSteps}
                                    onValueChange={(v) => setNovelaiSteps(v!)}
                                    className="config-input"
                                />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-field">
                                <label>CFG Scale</label>
                                <NumberInput
                                    min={1}
                                    max={20}
                                    step={0.5}
                                    integer={false}
                                    value={novelaiScale}
                                    onValueChange={(v) => setNovelaiScale(v!)}
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

            {/* AI Prompt Builder Modal - supports object and scene contexts */}
            {showPromptBuilder && (objectType && objectId ? (
                <UnifiedImagePromptModal
                    isOpen={showPromptBuilder}
                    onClose={() => setShowPromptBuilder(false)}
                    onPromptGenerated={handlePromptBuilderGenerated}
                    onStreamingStart={handleStreamingStart}
                    onStreamingError={handleStreamingError}
                    contextType="object"
                    objectType={objectType as 'basic_info' | 'character' | 'location' | 'organization' | 'lorebook'}
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

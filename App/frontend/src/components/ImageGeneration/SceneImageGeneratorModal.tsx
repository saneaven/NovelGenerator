/**
 * SceneImageGeneratorModal - Modal for generating scene images with story context
 *
 * Features:
 * - Prompt input with AI assist
 * - Reference objects from story (characters, locations, etc.)
 * - Reference image selection for image-to-image generation
 * - Scene context (pre/post text)
 * - Provider/model/size settings
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useModalHistory } from '../../hooks/useModalHistory';
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
    NOVELAI_REFERENCE_MODES,
    PROVIDER_PROMPT_TYPES,
    DEFAULT_NOVELAI_SETTINGS,
    listImageProviders,
    type ImageProviderType,
    type ImageGenerationRequest,
    type ReferenceImage,
    type ImageReferenceObject,
    type NovelAIReferenceMode,
} from '../../imageGeneration';
import type { PromptMode, PromptResult } from './ScenePromptAssistModal';
import type { Asset, ImageProvider } from '../../api/assetService';
import ReferenceImagePickerModal from './ReferenceImagePickerModal';
import ScenePromptAssistModal from './ScenePromptAssistModal';
import { Check, Sparkle } from '../icons';
import './SceneImageGeneratorModal.css';

// Story object types
type StoryObjectType = 'character' | 'location' | 'organization' | 'lorebook';

interface SceneContext {
    preContext: string;
    postContext: string;
}

// Simplified reference image - just asset info, no object metadata
interface ReferenceImageItem {
    assetId: string;
    thumbnailUrl: string;
}

// Initial settings for regeneration mode - pre-fill form with existing asset's settings
export interface InitialGenerationSettings {
    prompt?: string;
    positivePrompt?: string;
    negativePrompt?: string;
    provider?: ImageProviderType;
    model?: string;
    size?: string;
    // Gemini
    geminiAspectRatio?: string;
    geminiResolution?: string;
    // OpenAI
    openaiQuality?: 'standard' | 'hd';
    openaiStyle?: 'natural' | 'vivid';
    // NovelAI
    novelaiSampler?: string;
    novelaiSteps?: number;
    novelaiScale?: number;
    novelaiNoiseSchedule?: string;
    // Styles
    selectedNaturalStyleId?: string | null;
    selectedTagBasedStyleId?: string | null;
}

interface SceneImageGeneratorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImageGenerated: (asset: Asset) => void;
    sceneContext?: SceneContext;
    // For regeneration mode - pre-fill with existing asset's settings
    initialSettings?: InitialGenerationSettings;
    mode?: 'generate' | 'regenerate';
}

const SceneImageGeneratorModal: React.FC<SceneImageGeneratorModalProps> = ({
    isOpen,
    onClose,
    onImageGenerated,
    sceneContext,
    initialSettings,
    mode = 'generate',
}) => {
    useModalHistory(isOpen, onClose);
    const { currentProjectId } = useProjectStore();
    const { settings } = useSettingsStore();
    const { listObjects } = useUnifiedObjectStore();

    // Use the new image generation hook
    const { generate, isGenerating, error } = useImageGeneration({
        taskType: 'scene-image',
        onComplete: (result) => {
            if (result.asset) {
                const asset: Asset = {
                    id: result.asset.id,
                    project_id: result.asset.projectId,
                    name: result.asset.name,
                    file_path: result.asset.filePath,
                    thumbnail_path: result.asset.thumbnailPath,
                    mime_type: result.asset.mimeType,
                    asset_type: 'scene',  // Scene images are always type 'scene'
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
                onClose();
            }
        },
    });

    // Provider info with image input support
    const [providers, setProviders] = useState<ImageProvider[]>([]);

    // Form state
    const [prompt, setPrompt] = useState('');  // For natural language providers
    const [positivePrompt, setPositivePrompt] = useState('');  // For tag-based providers
    const [negativePrompt, setNegativePrompt] = useState('');  // For tag-based providers
    const [activePromptTab, setActivePromptTab] = useState<'positive' | 'negative'>('positive');
    const [provider, setProvider] = useState<ImageProviderType>(settings.imageGenConfig.provider);
    const [model, setModel] = useState(settings.imageGenConfig.model);
    const [size, setSize] = useState(settings.imageGenConfig.size);
    const [geminiAspectRatio, setGeminiAspectRatio] = useState(settings.imageGenConfig.geminiSettings.aspect_ratio);
    const [geminiResolution, setGeminiResolution] = useState(settings.imageGenConfig.geminiSettings.image_resolution);

    // OpenAI-specific settings
    const [openaiQuality, setOpenaiQuality] = useState<'standard' | 'hd'>(settings.imageGenConfig.openaiSettings.quality);
    const [openaiStyle, setOpenaiStyle] = useState<'natural' | 'vivid'>(settings.imageGenConfig.openaiSettings.style);

    // NovelAI-specific settings
    const [novelaiSampler, setNovelaiSampler] = useState(settings.imageGenConfig.novelaiSettings.sampler);
    const [novelaiSteps, setNovelaiSteps] = useState(settings.imageGenConfig.novelaiSettings.steps);
    const [novelaiScale, setNovelaiScale] = useState(settings.imageGenConfig.novelaiSettings.scale);
    const [novelaiNoiseSchedule, setNovelaiNoiseSchedule] = useState(settings.imageGenConfig.novelaiSettings.noise_schedule);

    // NovelAI reference image settings (i2i / Vibe Transfer)
    const [novelaiReferenceMode, setNovelaiReferenceMode] = useState<NovelAIReferenceMode>(DEFAULT_NOVELAI_SETTINGS.referenceMode);
    const [novelaiStrength, setNovelaiStrength] = useState(DEFAULT_NOVELAI_SETTINGS.strength);
    const [novelaiI2iNoise, setNovelaiI2iNoise] = useState(DEFAULT_NOVELAI_SETTINGS.i2iNoise);
    const [novelaiVibeStrength, setNovelaiVibeStrength] = useState(DEFAULT_NOVELAI_SETTINGS.vibeStrength);
    const [novelaiVibeInfoExtracted, setNovelaiVibeInfoExtracted] = useState(DEFAULT_NOVELAI_SETTINGS.vibeInfoExtracted);

    // Style selection
    const [selectedNaturalStyleId, setSelectedNaturalStyleId] = useState<string | null>(
        settings.imageGenConfig.selectedNaturalStyleId
    );
    const [selectedTagBasedStyleId, setSelectedTagBasedStyleId] = useState<string | null>(
        settings.imageGenConfig.selectedTagBasedStyleId
    );

    // Derived: check if current provider uses tag-based prompts
    const isTagBased = PROVIDER_PROMPT_TYPES[provider] === 'tag_based';

    // Style lists from settings
    const naturalStyles = settings.imageGenConfig.naturalStyles || [];
    const tagBasedStyles = settings.imageGenConfig.tagBasedStyles || [];

    // Helper functions for getting current styles
    const getCurrentNaturalStyle = useCallback(() => {
        if (!selectedNaturalStyleId) return null;
        return naturalStyles.find((s) => s.id === selectedNaturalStyleId) || null;
    }, [selectedNaturalStyleId, naturalStyles]);

    const getCurrentTagBasedStyle = useCallback(() => {
        if (!selectedTagBasedStyleId) return null;
        return tagBasedStyles.find((s) => s.id === selectedTagBasedStyleId) || null;
    }, [selectedTagBasedStyleId, tagBasedStyles]);

    // Get current prompt mode for AI assist
    const getCurrentPromptMode = useCallback((): PromptMode => {
        if (isTagBased) {
            return activePromptTab === 'positive' ? 'positive' : 'negative';
        }
        return 'natural';
    }, [isTagBased, activePromptTab]);

    // Reference images (simplified - just image references, no object metadata)
    const [referenceImages, setReferenceImages] = useState<ReferenceImageItem[]>([]);

    // All story objects for AI prompt generation
    const [allStoryObjects, setAllStoryObjects] = useState<ImageReferenceObject[]>([]);

    // Sub-modal states
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [showPromptAssistModal, setShowPromptAssistModal] = useState(false);

    // Load providers on mount
    useEffect(() => {
        if (isOpen) {
            listImageProviders().then(setProviders).catch(console.error);
        }
    }, [isOpen]);

    // Load all story objects for AI prompt generation
    useEffect(() => {
        if (!isOpen || !currentProjectId) return;

        const loadAllObjects = async () => {
            const allObjects: ImageReferenceObject[] = [];
            const objectTypes: StoryObjectType[] = ['character', 'location', 'organization', 'lorebook'];

            for (const objType of objectTypes) {
                try {
                    const objects = await listObjects(objType, currentProjectId);
                    for (const obj of objects) {
                        const data = obj.data[settings.mainLanguage] || Object.values(obj.data)[0] || {};
                        allObjects.push({
                            id: obj.id,
                            type: objType,
                            name: data.name || data.title || obj.id,
                            description: data.description || '',
                            // Include saved image prompts from metadata (convert null to undefined)
                            metadata: obj.metadata ? {
                                image_prompt: obj.metadata.image_prompt ?? undefined,
                                image_prompt_positive: obj.metadata.image_prompt_positive ?? undefined,
                                image_prompt_negative: obj.metadata.image_prompt_negative ?? undefined,
                            } : undefined,
                        });
                    }
                } catch (err) {
                    console.error(`Failed to load ${objType} objects:`, err);
                }
            }

            setAllStoryObjects(allObjects);
        };

        loadAllObjects();
    }, [isOpen, currentProjectId, listObjects, settings.mainLanguage]);

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

    // Add reference image
    const handleImageSelected = useCallback((assetId: string, thumbnailUrl: string) => {
        // Avoid duplicates
        if (referenceImages.some(img => img.assetId === assetId)) {
            setShowImagePicker(false);
            return;
        }

        setReferenceImages(prev => [...prev, { assetId, thumbnailUrl }]);
        setShowImagePicker(false);
    }, [referenceImages]);

    // Remove reference image
    const handleRemoveImage = useCallback((assetId: string) => {
        setReferenceImages(prev => prev.filter(img => img.assetId !== assetId));
    }, []);

    // Handler for AI prompt generation result from ScenePromptAssistModal
    // Uses mode from result to avoid closure capture issues when provider changes during LLM execution
    const handlePromptGenerated = useCallback((result: PromptResult) => {
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
    }, []);  // No dependencies - mode comes from result

    // Generate image
    const handleGenerate = async () => {
        // Check if we have the required prompt
        const hasPrompt = isTagBased ? positivePrompt.trim() : prompt.trim();
        if (!currentProjectId || !hasPrompt) return;

        // Build reference images data (simplified - just asset IDs)
        const referenceImagesData: ReferenceImage[] = referenceImages.map(img => ({
            assetId: img.assetId,
            strength: 0.7,
        }));

        const request: ImageGenerationRequest = {
            prompt: !isTagBased ? prompt.trim() : undefined,
            positivePrompt: isTagBased ? positivePrompt.trim() : undefined,
            negativePrompt: isTagBased && negativePrompt.trim() ? negativePrompt.trim() : undefined,
            provider,
            model,
            size: provider === 'gemini' ? undefined : size,
            aspectRatio: provider === 'gemini' ? geminiAspectRatio : undefined,
            resolution: provider === 'gemini' ? geminiResolution : undefined,
            referenceImages: supportsImageInput && referenceImagesData.length > 0 ? referenceImagesData : undefined,
            // Style selection
            styleId: isTagBased ? selectedTagBasedStyleId : selectedNaturalStyleId,
            // OpenAI-specific settings
            quality: provider === 'openai' ? openaiQuality : undefined,
            style: provider === 'openai' ? openaiStyle : undefined,
            // NovelAI-specific settings
            sampler: provider === 'novelai' ? novelaiSampler : undefined,
            steps: provider === 'novelai' ? novelaiSteps : undefined,
            scale: provider === 'novelai' ? novelaiScale : undefined,
            noiseSchedule: provider === 'novelai' ? novelaiNoiseSchedule : undefined,
            // NovelAI reference image settings (i2i / Vibe Transfer)
            referenceMode: provider === 'novelai' ? novelaiReferenceMode : undefined,
            strength: provider === 'novelai' ? novelaiStrength : undefined,
            i2iNoise: provider === 'novelai' ? novelaiI2iNoise : undefined,
            vibeStrength: provider === 'novelai' ? novelaiVibeStrength : undefined,
            vibeInfoExtracted: provider === 'novelai' ? novelaiVibeInfoExtracted : undefined,
            // Asset type for scene images
            assetType: 'scene',
        };

        await generate(request);
    };

    // Apply initialSettings when modal opens in regenerate mode
    useEffect(() => {
        if (isOpen && initialSettings) {
            // Apply all provided settings
            if (initialSettings.prompt !== undefined) setPrompt(initialSettings.prompt);
            if (initialSettings.positivePrompt !== undefined) setPositivePrompt(initialSettings.positivePrompt);
            if (initialSettings.negativePrompt !== undefined) setNegativePrompt(initialSettings.negativePrompt);
            if (initialSettings.provider !== undefined) setProvider(initialSettings.provider);
            if (initialSettings.model !== undefined) setModel(initialSettings.model);
            if (initialSettings.size !== undefined) setSize(initialSettings.size);
            if (initialSettings.geminiAspectRatio !== undefined) setGeminiAspectRatio(initialSettings.geminiAspectRatio);
            if (initialSettings.geminiResolution !== undefined) setGeminiResolution(initialSettings.geminiResolution);
            if (initialSettings.openaiQuality !== undefined) setOpenaiQuality(initialSettings.openaiQuality);
            if (initialSettings.openaiStyle !== undefined) setOpenaiStyle(initialSettings.openaiStyle);
            if (initialSettings.novelaiSampler !== undefined) setNovelaiSampler(initialSettings.novelaiSampler);
            if (initialSettings.novelaiSteps !== undefined) setNovelaiSteps(initialSettings.novelaiSteps);
            if (initialSettings.novelaiScale !== undefined) setNovelaiScale(initialSettings.novelaiScale);
            if (initialSettings.novelaiNoiseSchedule !== undefined) setNovelaiNoiseSchedule(initialSettings.novelaiNoiseSchedule);
            if (initialSettings.selectedNaturalStyleId !== undefined) setSelectedNaturalStyleId(initialSettings.selectedNaturalStyleId);
            if (initialSettings.selectedTagBasedStyleId !== undefined) setSelectedTagBasedStyleId(initialSettings.selectedTagBasedStyleId);
        }
    }, [isOpen, initialSettings]);

    // Reset form when modal closes (only if not in regenerate mode, or always reset prompts)
    useEffect(() => {
        if (!isOpen) {
            // Always reset prompts and reference images when closing
            setPrompt('');
            setPositivePrompt('');
            setNegativePrompt('');
            setActivePromptTab('positive');
            setReferenceImages([]);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const currentModelOptions = MODEL_OPTIONS[provider] || [];
    const currentSizeOptions = SIZE_OPTIONS[provider] || ['1024x1024'];

    return (
        <div className="scene-image-generator-overlay" onClick={onClose}>
            <div className="scene-image-generator-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{mode === 'regenerate' ? 'Regenerate Image' : 'Generate Scene Image'}</h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="modal-body">
                    {/* Scene Context Info */}
                    {sceneContext && (sceneContext.preContext || sceneContext.postContext) && (
                        <div className="scene-context-info">
                            <span className="context-label">Scene context will be included in prompt generation</span>
                        </div>
                    )}

                    {/* Prompt Input - Provider-based switching */}
                    <div className="form-section">
                        <label>Prompt</label>

                        {isTagBased ? (
                            <>
                                {/* Tab bar for NovelAI (tag-based) */}
                                <div className="prompt-tabs">
                                    <button
                                        className={`prompt-tab ${activePromptTab === 'positive' ? 'active' : ''}`}
                                        onClick={() => setActivePromptTab('positive')}
                                        type="button"
                                    >
                                        Positive {positivePrompt && <Check size={12} />}
                                    </button>
                                    <button
                                        className={`prompt-tab ${activePromptTab === 'negative' ? 'active' : ''}`}
                                        onClick={() => setActivePromptTab('negative')}
                                        type="button"
                                    >
                                        Negative {negativePrompt && <Check size={12} />}
                                    </button>
                                </div>
                                <div className="prompt-input-wrapper">
                                    <textarea
                                        value={activePromptTab === 'positive' ? positivePrompt : negativePrompt}
                                        onChange={(e) => {
                                            if (activePromptTab === 'positive') {
                                                setPositivePrompt(e.target.value);
                                            } else {
                                                setNegativePrompt(e.target.value);
                                            }
                                        }}
                                        placeholder={activePromptTab === 'positive'
                                            ? "Tags describing what to include (e.g., 1girl, fantasy, castle, sunset)..."
                                            : "Tags describing what to avoid (e.g., lowres, bad anatomy, blurry)..."
                                        }
                                        rows={4}
                                        className="prompt-input"
                                    />
                                    <button
                                        className="ai-assist-btn"
                                        onClick={() => setShowPromptAssistModal(true)}
                                        disabled={!sceneContext}
                                        title={!sceneContext ? 'Scene context required' : 'AI-assisted prompt generation'}
                                        type="button"
                                    >
                                        <Sparkle size={14} /> AI Assist
                                    </button>
                                </div>
                            </>
                        ) : (
                            /* Single textarea for natural language providers */
                            <div className="prompt-input-wrapper">
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="Describe the scene image you want to generate..."
                                    rows={4}
                                    className="prompt-input"
                                />
                                <button
                                    className="ai-assist-btn"
                                    onClick={() => setShowPromptAssistModal(true)}
                                    disabled={!sceneContext}
                                    title={!sceneContext ? 'Scene context required' : 'AI-assisted prompt generation'}
                                    type="button"
                                >
                                    <Sparkle size={14} /> AI Assist
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Reference Images Section */}
                    <div className="form-section">
                        <div className="section-header">
                            <label>Reference Images</label>
                            <button
                                className="add-object-btn"
                                onClick={() => setShowImagePicker(true)}
                                type="button"
                                disabled={!supportsImageInput}
                                title={supportsImageInput ? 'Add reference image' : 'Provider does not support image input'}
                            >
                                + Add Image
                            </button>
                        </div>

                        {!supportsImageInput ? (
                            <div className="empty-objects">
                                <span>Image references not supported</span>
                                <span className="hint">{PROVIDER_LABELS[provider]} does not support image-to-image generation</span>
                            </div>
                        ) : referenceImages.length === 0 ? (
                            <div className="empty-objects">
                                <span>No reference images added</span>
                                <span className="hint">Add images from your story objects or upload new ones</span>
                            </div>
                        ) : (
                            <div className="reference-images-grid">
                                {referenceImages.map(img => (
                                    <div key={img.assetId} className="reference-image-item">
                                        <img src={img.thumbnailUrl} alt="Reference" />
                                        <button
                                            className="remove-image-btn"
                                            onClick={() => handleRemoveImage(img.assetId)}
                                            title="Remove image"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Provider Settings */}
                    <div className="form-section settings-section">
                        <div className="form-row">
                            <div className="form-field">
                                <label>Provider</label>
                                <select
                                    value={provider}
                                    onChange={(e) => {
                                        const newProvider = e.target.value as ImageProviderType;
                                        setProvider(newProvider);
                                        setModel(MODEL_OPTIONS[newProvider]?.[0]?.id || '');
                                        setSize(SIZE_OPTIONS[newProvider]?.[0] || '1024x1024');
                                    }}
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
                                                <option key={ar} value={ar}>{ar}</option>
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
                                                <option key={r} value={r}>{r}</option>
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
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* Style Selection */}
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
                            </div>
                        )}
                    </div>

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
                </div>

                <div className="modal-footer">
                    <button className="cancel-btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="generate-btn"
                        onClick={handleGenerate}
                        disabled={isGenerating || !(isTagBased ? positivePrompt.trim() : prompt.trim())}
                    >
                        {isGenerating
                            ? 'Generating...'
                            : mode === 'regenerate'
                            ? 'Regenerate'
                            : 'Generate Image'}
                    </button>
                </div>

                {/* Reference Image Picker Sub-modal */}
                {showImagePicker && (
                    <ReferenceImagePickerModal
                        isOpen={showImagePicker}
                        onClose={() => setShowImagePicker(false)}
                        onImageSelected={handleImageSelected}
                        excludeAssetIds={referenceImages.map(img => img.assetId)}
                    />
                )}

                {/* AI Prompt Assistant Sub-modal */}
                {showPromptAssistModal && sceneContext && (
                    <ScenePromptAssistModal
                        isOpen={showPromptAssistModal}
                        onClose={() => setShowPromptAssistModal(false)}
                        onPromptGenerated={handlePromptGenerated}
                        sceneContext={sceneContext}
                        promptMode={getCurrentPromptMode()}
                        allStoryObjects={allStoryObjects}
                    />
                )}

            </div>
        </div>
    );
};

export default SceneImageGeneratorModal;

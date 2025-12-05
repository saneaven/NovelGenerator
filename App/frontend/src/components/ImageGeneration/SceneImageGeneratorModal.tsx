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
    listImageProviders,
    type ImageProviderType,
    type ImageGenerationRequest,
    type ReferenceObject,
    type ReferenceImage,
} from '../../imageGeneration';
import type { PromptMode, PromptResult } from './ScenePromptAssistModal';
import type { Asset, ImageProvider } from '../../api/assetService';
import type { ImageReferenceObject } from '../../chat/managers/SystemPromptManager';
import ObjectImagePickerModal from './ObjectImagePickerModal';
import ScenePromptAssistModal from './ScenePromptAssistModal';
import './SceneImageGeneratorModal.css';

// Story object types
type StoryObjectType = 'character' | 'location' | 'organization' | 'lorebook';

interface SceneContext {
    preContext: string;
    postContext: string;
}

interface ReferenceObjectWithImage {
    id: string;
    type: StoryObjectType;
    name: string;
    selectedAssetId?: string;
    selectedAssetUrl?: string;
}

interface SceneImageGeneratorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImageGenerated: (asset: Asset) => void;
    sceneContext?: SceneContext;
}

const OBJECT_TYPE_LABELS: Record<StoryObjectType, string> = {
    character: 'Character',
    location: 'Location',
    organization: 'Organization',
    lorebook: 'Lorebook',
};

const OBJECT_TYPE_ICONS: Record<StoryObjectType, string> = {
    character: '👤',
    location: '📍',
    organization: '🏢',
    lorebook: '📖',
};

const SceneImageGeneratorModal: React.FC<SceneImageGeneratorModalProps> = ({
    isOpen,
    onClose,
    onImageGenerated,
    sceneContext,
}) => {
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

    // Reference objects with optional images
    const [referenceObjects, setReferenceObjects] = useState<ReferenceObjectWithImage[]>([]);

    // All story objects for AI prompt generation
    const [allStoryObjects, setAllStoryObjects] = useState<ImageReferenceObject[]>([]);

    // Sub-modal states
    const [showObjectPicker, setShowObjectPicker] = useState(false);
    const [showImagePicker, setShowImagePicker] = useState(false);
    const [imagePickerObjectId, setImagePickerObjectId] = useState<string | null>(null);
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

    // Add reference object
    const handleAddObject = useCallback((objectId: string, objectType: StoryObjectType, objectName: string) => {
        if (referenceObjects.some(obj => obj.id === objectId)) return;

        setReferenceObjects(prev => [
            ...prev,
            { id: objectId, type: objectType, name: objectName }
        ]);
    }, [referenceObjects]);

    // Remove reference object
    const handleRemoveObject = useCallback((objectId: string) => {
        setReferenceObjects(prev => prev.filter(obj => obj.id !== objectId));
    }, []);

    // Open image picker for an object
    const handleSelectImage = useCallback((objectId: string) => {
        setImagePickerObjectId(objectId);
        setShowImagePicker(true);
    }, []);

    // Set selected image for object
    const handleImageSelected = useCallback((assetId: string, assetUrl: string) => {
        if (!imagePickerObjectId) return;

        setReferenceObjects(prev =>
            prev.map(obj =>
                obj.id === imagePickerObjectId
                    ? { ...obj, selectedAssetId: assetId, selectedAssetUrl: assetUrl }
                    : obj
            )
        );
        setShowImagePicker(false);
        setImagePickerObjectId(null);
    }, [imagePickerObjectId]);

    // Clear selected image for object
    const handleClearImage = useCallback((objectId: string) => {
        setReferenceObjects(prev =>
            prev.map(obj =>
                obj.id === objectId
                    ? { ...obj, selectedAssetId: undefined, selectedAssetUrl: undefined }
                    : obj
            )
        );
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

        // Build reference images (only for objects that have selected images)
        const referenceImagesData: ReferenceImage[] = referenceObjects
            .filter(obj => obj.selectedAssetId)
            .map(obj => ({
                assetId: obj.selectedAssetId!,
                strength: 0.7,
            }));

        // Build reference objects data for metadata
        const referenceObjectsData: ReferenceObject[] = referenceObjects.map(obj => ({
            id: obj.id,
            type: obj.type,
            name: obj.name,
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
            referenceObjects: referenceObjectsData.length > 0 ? referenceObjectsData : undefined,
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
        };

        await generate(request);
    };

    // Reset form when modal closes
    useEffect(() => {
        if (!isOpen) {
            setPrompt('');
            setPositivePrompt('');
            setNegativePrompt('');
            setActivePromptTab('positive');
            setReferenceObjects([]);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const currentModelOptions = MODEL_OPTIONS[provider] || [];
    const currentSizeOptions = SIZE_OPTIONS[provider] || ['1024x1024'];

    return (
        <div className="scene-image-generator-overlay" onClick={onClose}>
            <div className="scene-image-generator-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Generate Scene Image</h2>
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
                                        Positive {positivePrompt && '✓'}
                                    </button>
                                    <button
                                        className={`prompt-tab ${activePromptTab === 'negative' ? 'active' : ''}`}
                                        onClick={() => setActivePromptTab('negative')}
                                        type="button"
                                    >
                                        Negative {negativePrompt && '✓'}
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
                                        ✨ AI Assist
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
                                    ✨ AI Assist
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Reference Objects Section */}
                    <div className="form-section">
                        <div className="section-header">
                            <label>Reference Objects</label>
                            <button
                                className="add-object-btn"
                                onClick={() => setShowObjectPicker(true)}
                                type="button"
                            >
                                + Add Object
                            </button>
                        </div>

                        {referenceObjects.length === 0 ? (
                            <div className="empty-objects">
                                <span>No reference objects added</span>
                                <span className="hint">Add characters, locations, or other story objects to include in generation</span>
                            </div>
                        ) : (
                            <div className="reference-objects-list">
                                {referenceObjects.map(obj => (
                                    <div key={obj.id} className="reference-object-item">
                                        <div className="object-info">
                                            <span className="object-icon">{OBJECT_TYPE_ICONS[obj.type]}</span>
                                            <span className="object-name">{obj.name}</span>
                                            <span className="object-type">{OBJECT_TYPE_LABELS[obj.type]}</span>
                                        </div>

                                        <div className="object-image-section">
                                            {obj.selectedAssetUrl ? (
                                                <div className="selected-image">
                                                    <img src={obj.selectedAssetUrl} alt={obj.name} />
                                                    <div className="image-actions">
                                                        <button
                                                            className="change-image-btn"
                                                            onClick={() => handleSelectImage(obj.id)}
                                                            title="Change image"
                                                        >
                                                            🔄
                                                        </button>
                                                        <button
                                                            className="clear-image-btn"
                                                            onClick={() => handleClearImage(obj.id)}
                                                            title="Remove image"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <button
                                                    className={`image-placeholder ${supportsImageInput ? '' : 'disabled'}`}
                                                    onClick={() => supportsImageInput && handleSelectImage(obj.id)}
                                                    title={supportsImageInput ? 'Select reference image' : 'Provider does not support image input'}
                                                    disabled={!supportsImageInput}
                                                >
                                                    <span className="placeholder-icon">🖼️</span>
                                                    <span className="placeholder-text">
                                                        {supportsImageInput ? 'Add Image' : 'No image support'}
                                                    </span>
                                                </button>
                                            )}
                                        </div>

                                        <button
                                            className="remove-object-btn"
                                            onClick={() => handleRemoveObject(obj.id)}
                                            title="Remove object"
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {!supportsImageInput && referenceObjects.length > 0 && (
                            <div className="image-support-notice">
                                <span>💡 {PROVIDER_LABELS[provider]} does not support image-to-image generation. Only object metadata will be used.</span>
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
                        {isGenerating ? 'Generating...' : 'Generate Image'}
                    </button>
                </div>

                {/* Object Picker Sub-modal */}
                {showObjectPicker && (
                    <ObjectPickerModal
                        isOpen={showObjectPicker}
                        onClose={() => setShowObjectPicker(false)}
                        onSelect={handleAddObject}
                        excludeIds={referenceObjects.map(obj => obj.id)}
                    />
                )}

                {/* Image Picker Sub-modal */}
                {showImagePicker && imagePickerObjectId && (
                    <ObjectImagePickerModal
                        isOpen={showImagePicker}
                        onClose={() => {
                            setShowImagePicker(false);
                            setImagePickerObjectId(null);
                        }}
                        objectId={imagePickerObjectId}
                        objectType={referenceObjects.find(obj => obj.id === imagePickerObjectId)?.type || 'character'}
                        onImageSelected={handleImageSelected}
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

// Simple Object Picker Modal (inline)
interface ObjectPickerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (objectId: string, objectType: StoryObjectType, objectName: string) => void;
    excludeIds: string[];
}

const ObjectPickerModal: React.FC<ObjectPickerModalProps> = ({
    isOpen,
    onClose,
    onSelect,
    excludeIds,
}) => {
    const { currentProjectId } = useProjectStore();
    const { settings } = useSettingsStore();
    const { listObjects } = useUnifiedObjectStore();
    const [activeTab, setActiveTab] = useState<StoryObjectType>('character');
    const [searchTerm, setSearchTerm] = useState('');
    const [loadedObjects, setLoadedObjects] = useState<{ id: string; name: string }[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!isOpen || !currentProjectId) return;

        const loadObjects = async () => {
            setIsLoading(true);
            try {
                const objects = await listObjects(activeTab, currentProjectId);
                const mappedObjects = objects.map(obj => {
                    const mainLang = settings.mainLanguage;
                    const data = obj.data[mainLang] || obj.data[Object.keys(obj.data)[0]] || {};
                    return {
                        id: obj.id,
                        name: data.name || data.title || obj.id,
                    };
                });
                setLoadedObjects(mappedObjects);
            } catch (err) {
                console.error('Failed to load objects:', err);
                setLoadedObjects([]);
            } finally {
                setIsLoading(false);
            }
        };

        loadObjects();
    }, [isOpen, currentProjectId, activeTab, listObjects, settings.mainLanguage]);

    const filteredObjects = useMemo(() => {
        return loadedObjects.filter(obj =>
            !excludeIds.includes(obj.id) &&
            obj.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [loadedObjects, excludeIds, searchTerm]);

    if (!isOpen) return null;

    return (
        <div className="object-picker-overlay" onClick={onClose}>
            <div className="object-picker-modal" onClick={e => e.stopPropagation()}>
                <div className="picker-header">
                    <h3>Add Reference Object</h3>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>

                <div className="picker-tabs">
                    {(Object.keys(OBJECT_TYPE_LABELS) as StoryObjectType[]).map(type => (
                        <button
                            key={type}
                            className={`picker-tab ${activeTab === type ? 'active' : ''}`}
                            onClick={() => setActiveTab(type)}
                        >
                            {OBJECT_TYPE_ICONS[type]} {OBJECT_TYPE_LABELS[type]}
                        </button>
                    ))}
                </div>

                <div className="picker-search">
                    <input
                        type="text"
                        placeholder={`Search ${OBJECT_TYPE_LABELS[activeTab].toLowerCase()}s...`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="picker-list">
                    {isLoading ? (
                        <div className="picker-empty">Loading...</div>
                    ) : filteredObjects.length === 0 ? (
                        <div className="picker-empty">
                            No {OBJECT_TYPE_LABELS[activeTab].toLowerCase()}s found
                        </div>
                    ) : (
                        filteredObjects.map(obj => (
                            <button
                                key={obj.id}
                                className="picker-item"
                                onClick={() => {
                                    onSelect(obj.id, activeTab, obj.name);
                                    onClose();
                                }}
                            >
                                <span className="item-icon">{OBJECT_TYPE_ICONS[activeTab]}</span>
                                <span className="item-name">{obj.name}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

export default SceneImageGeneratorModal;

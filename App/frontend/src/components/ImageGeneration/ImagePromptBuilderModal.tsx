import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { LLMRequestManager } from '../../chat/sessions/LLMRequestManager';
import { LLMRequestPipeline } from '../../chat/LLMRequestPipeline';
import type { ImagePromptContext } from '../../chat/managers/SystemPromptManager';
import './ImagePromptBuilderModal.css';

interface ChapterContext {
    chapterId: string;
    chapterName: string;
    chapterDescription: string;
    actId: string;
    selectedText: string | null;
    scenePreContext?: string;
    scenePostContext?: string;
}

interface TargetObject {
    id: string;
    name: string;
    description: string;
}

export type PromptMode = 'natural' | 'positive' | 'negative';

interface ImagePromptBuilderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onPromptGenerated: (prompt: string) => void;
    chapterContext?: ChapterContext;
    objectType?: string;
    objectId?: string;
    /** Which type of prompt is being generated: natural (OpenAI/Gemini/xAI), positive tags, or negative tags (NovelAI) */
    promptMode?: PromptMode;
}

const ImagePromptBuilderModal: React.FC<ImagePromptBuilderModalProps> = ({
    isOpen,
    onClose,
    onPromptGenerated,
    chapterContext,
    objectType,
    objectId,
    promptMode = 'natural',
}) => {
    const { settings } = useSettingsStore();
    const unifiedStore = useUnifiedObjectStore();

    // Main input
    const [userRequest, setUserRequest] = useState('');

    // Generation state
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedPrompt, setGeneratedPrompt] = useState('');
    const [error, setError] = useState<string | null>(null);

    const abortControllerRef = useRef<AbortController | null>(null);
    const taskRunnerRef = useRef<LLMRequestManager | null>(null);

    // Auto-compute request types based on props
    const isCharacterRequest = objectType === 'character';
    const isLocationRequest = objectType === 'location';
    const isOrganizationRequest = objectType === 'organization';
    const isLorebookRequest = objectType === 'lorebrook';
    const isSceneRequest = !!(chapterContext?.scenePreContext || chapterContext?.scenePostContext);

    // Get the object data directly for proper dependency tracking
    const objectData = objectId ? unifiedStore.objects[objectId] : null;

    // Get target object from cache (synchronous - data is already loaded)
    const targetObject = useMemo((): TargetObject | null => {
        if (!objectId || !objectData) return null;
        const data = objectData.data[settings.mainLanguage] || Object.values(objectData.data)[0] || {};
        return {
            id: objectData.id,
            name: data.name || '',
            description: data.description || '',
        };
    }, [objectId, objectData, settings.mainLanguage]);

    // Get saved image prompts from object metadata
    const savedPrompts = useMemo(() => {
        if (!objectId || !objectData) return null;
        if (!objectData.metadata) return null;
        return {
            natural: objectData.metadata.image_prompt || null,
            positive: objectData.metadata.image_prompt_positive || null,
            negative: objectData.metadata.image_prompt_negative || null,
        };
    }, [objectId, objectData]);

    // Reset on close
    useEffect(() => {
        if (!isOpen) {
            setUserRequest('');
            setGeneratedPrompt('');
            setError(null);
        }
    }, [isOpen]);

    // Helper function to get object info string
    const getObjectInfo = useCallback((): string | null => {
        if (!targetObject) return null;
        return `**${targetObject.name}**\n${targetObject.description}`;
    }, [targetObject]);

    // Get context type label for header
    const getContextTypeLabel = (): string => {
        if (isCharacterRequest) return 'Character';
        if (isLocationRequest) return 'Location';
        if (isOrganizationRequest) return 'Organization';
        if (isLorebookRequest) return 'Lorebook Entry';
        if (isSceneRequest) return 'Scene';
        return '';
    };

    // Build ImagePromptContext for the pipeline
    const buildImagePromptContext = useCallback((): ImagePromptContext => {
        const objectInfo = getObjectInfo();
        return {
            userRequest,
            promptMode,
            characterInfo: isCharacterRequest ? objectInfo : null,
            locationInfo: isLocationRequest ? objectInfo : null,
            organizationInfo: isOrganizationRequest ? objectInfo : null,
            lorebookInfo: isLorebookRequest ? objectInfo : null,
            scenePreContext: isSceneRequest ? chapterContext?.scenePreContext : null,
            scenePostContext: isSceneRequest ? chapterContext?.scenePostContext : null,
            currentPrompt: savedPrompts?.natural || null,
            currentPromptPositive: savedPrompts?.positive || null,
            currentPromptNegative: savedPrompts?.negative || null,
        };
    }, [userRequest, promptMode, isCharacterRequest, isLocationRequest, isOrganizationRequest, isLorebookRequest, isSceneRequest, chapterContext, savedPrompts, getObjectInfo]);

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        setError(null);
        setGeneratedPrompt('');

        const imagePromptConfig = settings.functionConfigs.imagePrompt;
        const providerConfig = settings.providerCredentials[imagePromptConfig.provider];

        try {
            // Build systemInsertConfig for imagePrompt type
            const systemInsertConfig = {
                enabled: true,
                includeProjectInfo: false,
                includeStoryObjects: false,
                includeNovelContent: false,
                promptType: 'imagePrompt' as const,
                promptContext: buildImagePromptContext(),
            };

            // Create LLMRequestManager
            taskRunnerRef.current = new LLMRequestManager(
                {
                    projectId: '', // Not needed for image prompt generation
                    getStoryObjects: () => ({}),
                    systemInsertConfig,
                    chatPipeline: new LLMRequestPipeline(),
                    provider: imagePromptConfig.provider,
                    providerConfig,
                    aiModel: imagePromptConfig.model,
                    temperature: imagePromptConfig.temperature,
                    mode: 'workspace',
                    enablePrefill: false,
                    retryConfig: settings.retryConfig,
                    abortControllerRef,
                },
                {
                    onStreamUpdate: (contentParts) => {
                        // Extract text content from contentParts
                        const text = contentParts
                            .filter(part => part.type === 'content')
                            .map(part => part.text)
                            .join('');
                        setGeneratedPrompt(text);
                    },
                    onFinalMessage: (message) => {
                        const text = message.contentParts
                            .filter(part => part.type === 'content')
                            .map(part => part.text)
                            .join('');
                        if (!text.trim()) {
                            setError('AI generated an empty response. Please try again.');
                        }
                    },
                    onError: (err) => {
                        if (err.name === 'AbortError') return;
                        console.error('Failed to generate image prompt:', err);
                        setError(err.message || 'Failed to generate prompt');
                    },
                }
            );

            // Run with no user message (context is in systemInsertConfig)
            await taskRunnerRef.current.run(null, {
                history: [],
                language: settings.mainLanguage,
            });
        } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') {
                return;
            }
            console.error('Failed to generate image prompt:', err);
            setError(err instanceof Error ? err.message : 'Failed to generate prompt');
        } finally {
            setIsGenerating(false);
            taskRunnerRef.current = null;
        }
    }, [settings, buildImagePromptContext]);

    const handleCancel = () => {
        taskRunnerRef.current?.abort();
        taskRunnerRef.current = null;
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        onClose();
    };

    const handleUsePrompt = () => {
        onPromptGenerated(generatedPrompt);
        onClose();
    };

    if (!isOpen) return null;

    const contextLabel = getContextTypeLabel();
    const hasContext = contextLabel !== '';

    return (
        <div className="modal-overlay" onClick={handleCancel}>
            <div className="modal-content image-prompt-builder-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>AI-Assisted Image Prompt Generator</h2>
                    <button className="modal-close" onClick={handleCancel}>&times;</button>
                </div>

                <div className="modal-body">
                    {/* Context indicator - shows what object we're generating for */}
                    {hasContext && (
                        <div className="context-indicator">
                            <span className="context-type">{contextLabel}:</span>
                            <span className="context-name">
                                {targetObject?.name || (isSceneRequest ? 'Scene from editor' : 'Loading...')}
                            </span>
                        </div>
                    )}

                    {/* User Request */}
                    <div className="form-group">
                        <label htmlFor="user-request">What do you want to visualize?</label>
                        <textarea
                            id="user-request"
                            value={userRequest}
                            onChange={(e) => setUserRequest(e.target.value)}
                            placeholder='e.g., "A dramatic portrait looking determined" or "The location at sunset with storm clouds approaching"'
                            rows={3}
                            disabled={isGenerating}
                        />
                    </div>

                    {/* Scene context info - auto-shown when scene context is available */}
                    {isSceneRequest && (
                        <div className="form-group scene-context-info">
                            <label>Scene Context (auto-captured from cursor)</label>
                            <div className="scene-context-preview">
                                {chapterContext?.scenePreContext && (
                                    <div className="context-preview-item">
                                        <span className="preview-label">Before:</span>
                                        <span className="preview-text">
                                            {chapterContext.scenePreContext.length > 100
                                                ? `...${chapterContext.scenePreContext.slice(-100)}`
                                                : chapterContext.scenePreContext}
                                        </span>
                                    </div>
                                )}
                                {chapterContext?.scenePostContext && (
                                    <div className="context-preview-item">
                                        <span className="preview-label">After:</span>
                                        <span className="preview-text">
                                            {chapterContext.scenePostContext.length > 100
                                                ? `${chapterContext.scenePostContext.slice(0, 100)}...`
                                                : chapterContext.scenePostContext}
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Generate Button */}
                    <div className="generate-section">
                        <button
                            className="generate-button"
                            onClick={handleGenerate}
                            disabled={isGenerating}
                        >
                            {isGenerating ? 'Generating...' : 'Generate Prompt'}
                        </button>
                    </div>

                    {/* Error Display */}
                    {error && (
                        <div className="error-message">{error}</div>
                    )}

                    {/* Generated Prompt Preview */}
                    {generatedPrompt && (
                        <div className="form-group generated-prompt-section">
                            <label>Generated Prompt</label>
                            <textarea
                                value={generatedPrompt}
                                onChange={(e) => setGeneratedPrompt(e.target.value)}
                                rows={5}
                                className="generated-prompt"
                            />
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="modal-footer">
                    <button onClick={handleCancel} className="btn-secondary" disabled={isGenerating}>
                        Cancel
                    </button>
                    <button
                        onClick={handleUsePrompt}
                        className="btn-primary"
                        disabled={!generatedPrompt.trim() || isGenerating}
                    >
                        Use This Prompt
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImagePromptBuilderModal;

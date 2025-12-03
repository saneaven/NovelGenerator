import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { LLMRequestManager } from '../../chat/sessions/LLMRequestManager';
import { LLMRequestPipeline } from '../../chat/LLMRequestPipeline';
import type { ObjectImagePromptContext } from '../../chat/managers/SystemPromptManager';
import { OBJECT_IMAGE_PROMPT_FUNCTION } from '../../chat/types/imagePromptFunctionSchemas';
import './ImagePromptBuilderModal.css';

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
    objectType: 'character' | 'location' | 'organization' | 'lorebook';
    objectId: string;
    /** Which type of prompt is being generated: natural (OpenAI/Gemini/xAI), positive tags, or negative tags (NovelAI) */
    promptMode?: PromptMode;
}

const ImagePromptBuilderModal: React.FC<ImagePromptBuilderModalProps> = ({
    isOpen,
    onClose,
    onPromptGenerated,
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

    // Get context type label for header
    const getContextTypeLabel = (): string => {
        switch (objectType) {
            case 'character': return 'Character';
            case 'location': return 'Location';
            case 'organization': return 'Organization';
            case 'lorebook': return 'Lorebook Entry';
            default: return '';
        }
    };

    // Get native output mode setting
    const isNativeOutput = settings.nativeOutputMode;

    // Build ObjectImagePromptContext for the pipeline
    const buildObjectImagePromptContext = useCallback((): ObjectImagePromptContext => {
        const objectInfo = targetObject
            ? `**${targetObject.name}**\n${targetObject.description}`
            : '';
        return {
            userRequest,
            promptMode,
            objectType,
            objectInfo,
            currentPrompt: savedPrompts?.natural || null,
            currentPromptPositive: savedPrompts?.positive || null,
            currentPromptNegative: savedPrompts?.negative || null,
            isNativeOutput,
        };
    }, [userRequest, promptMode, objectType, targetObject, savedPrompts, isNativeOutput]);

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        setError(null);
        setGeneratedPrompt('');

        const imagePromptConfig = settings.functionConfigs.imagePrompt;
        const providerConfig = settings.providerCredentials[imagePromptConfig.provider];

        try {
            // Build systemInsertConfig for objectImagePrompt type
            const systemInsertConfig = {
                enabled: true,
                includeProjectInfo: false,
                includeStoryObjects: false,
                includeNovelContent: false,
                promptType: 'objectImagePrompt' as const,
                promptContext: buildObjectImagePromptContext(),
            };

            // Create LLMRequestManager - conditionally use function calling based on native output mode
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
                    // Function calling configuration - skip when in native output mode
                    functions: isNativeOutput ? undefined : [OBJECT_IMAGE_PROMPT_FUNCTION],
                    toolChoice: isNativeOutput ? undefined : 'required',
                },
                {
                    onStreamUpdate: (contentParts) => {
                        // Show streaming text as progress indicator
                        const text = contentParts
                            .filter(part => part.type === 'content')
                            .map(part => part.text)
                            .join('');
                        if (text) {
                            // Native mode: always update (continuous streaming)
                            // Function mode: only show intermediate content before function call
                            if (isNativeOutput) {
                                setGeneratedPrompt(text);
                            }
                        }
                    },
                    onFunctionCalls: isNativeOutput ? undefined : async (functionCalls) => {
                        // Handle the function call response
                        const call = functionCalls.find(c => c.function_name === 'generate_object_image_prompt');
                        if (call && call.arguments) {
                            try {
                                // Arguments may be string or already parsed
                                const args = typeof call.arguments === 'string'
                                    ? JSON.parse(call.arguments)
                                    : call.arguments;
                                if (args.prompt) {
                                    setGeneratedPrompt(args.prompt);
                                }
                            } catch (e) {
                                console.error('Failed to parse function call arguments:', e);
                                setError('Failed to parse generated prompt. Please try again.');
                            }
                        }
                    },
                    onFinalMessage: (message) => {
                        // In native mode, use text content directly
                        // In function mode, this is a fallback if no function call was made
                        const text = message.contentParts
                            ?.filter(part => part.type === 'content')
                            .map(part => part.text)
                            .join('') || '';

                        if (isNativeOutput) {
                            // Native mode: use raw text output
                            if (text.trim()) {
                                setGeneratedPrompt(text.trim());
                            } else {
                                setError('AI did not generate a prompt. Please try again.');
                            }
                        } else {
                            // Function mode: fallback if no function call was made
                            if (!message.functionCalls?.length) {
                                if (text.trim()) {
                                    setGeneratedPrompt(text);
                                } else {
                                    setError('AI did not generate a prompt. Please try again.');
                                }
                            }
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
    }, [settings, buildObjectImagePromptContext, generatedPrompt, isNativeOutput]);

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

    return (
        <div className="modal-overlay" onClick={handleCancel}>
            <div className="modal-content image-prompt-builder-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>AI-Assisted Image Prompt Generator</h2>
                    <button className="modal-close" onClick={handleCancel}>&times;</button>
                </div>

                <div className="modal-body">
                    {/* Context indicator - shows what object we're generating for */}
                    <div className="context-indicator">
                        <span className="context-type">{contextLabel}:</span>
                        <span className="context-name">
                            {targetObject?.name || 'Loading...'}
                        </span>
                    </div>

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

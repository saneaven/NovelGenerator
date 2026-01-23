import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useLLMSessionStore } from '../../store/llmSessionStore';
import UnifiedImagePromptModal, { type PromptMode } from '../ImageGeneration/UnifiedImagePromptModal';
import ThinkingDisplay from '../common/ThinkingDisplay';
import type { ObjectType } from '../../types/unifiedObject';
import { TextButton } from '../TextButton';
import './ImagePromptManager.css';

interface ImagePromptManagerProps {
    objectType: string;
    objectId: string;
}

type PromptTabType = PromptMode;

const ImagePromptManager: React.FC<ImagePromptManagerProps> = ({
    objectType,
    objectId,
}) => {
    const { settings } = useSettingsStore();
    const {
        objects,
        loading,
        errors,
        updateImagePrompt,
        getObject,
    } = useUnifiedObjectStore();

    // Local state for editing
    const [naturalPrompt, setNaturalPrompt] = useState('');
    const [positivePrompt, setPositivePrompt] = useState('');
    const [negativePrompt, setNegativePrompt] = useState('');
    const [activeTab, setActiveTab] = useState<PromptTabType>('natural');
    const [showPromptBuilder, setShowPromptBuilder] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [hasChanges, setHasChanges] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    // Streaming state for AI Assist
    const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
    const [streamingMode, setStreamingMode] = useState<PromptMode | null>(null);
    const [streamingError, setStreamingError] = useState<string | null>(null);

    // Subscribe to streaming session from the store
    const streamingSession = useLLMSessionStore((state) =>
        streamingSessionId ? state.sessions[streamingSessionId] : undefined
    );

    // Get object from store
    const object = useMemo(() => {
        return getObject(objectId);
    }, [objectId, objects, getObject]);

    // Get object name for display (use title for basic_info, name for others)
    const objectName = useMemo(() => {
        if (!object) return 'Loading...';
        const data = object.data[settings.mainLanguage] || Object.values(object.data)[0] || {};
        return (objectType === 'basic_info' ? data.title : data.name) || 'Unnamed';
    }, [object, objectType, settings.mainLanguage]);

    // Determine if this is cover image mode (basic_info)
    const isCoverImage = objectType === 'basic_info';

    // Load initial values from object metadata
    useEffect(() => {
        if (object?.metadata) {
            const newNatural = object.metadata.image_prompt || '';
            const newPositive = object.metadata.image_prompt_positive || '';
            const newNegative = object.metadata.image_prompt_negative || '';

            setNaturalPrompt(newNatural);
            setPositivePrompt(newPositive);
            setNegativePrompt(newNegative);
            setHasChanges(false);
        }
    }, [object?.id, object?.metadata?.image_prompt, object?.metadata?.image_prompt_positive, object?.metadata?.image_prompt_negative]);

    // Track changes
    useEffect(() => {
        if (!object?.metadata) return;

        const origNatural = object.metadata.image_prompt || '';
        const origPositive = object.metadata.image_prompt_positive || '';
        const origNegative = object.metadata.image_prompt_negative || '';

        const changed =
            naturalPrompt !== origNatural ||
            positivePrompt !== origPositive ||
            negativePrompt !== origNegative;

        setHasChanges(changed);
    }, [naturalPrompt, positivePrompt, negativePrompt, object?.metadata]);

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
                case 'natural': setNaturalPrompt(streamingPrompt); break;
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

    const handleSave = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            await updateImagePrompt(
                objectType as ObjectType,
                objectId,
                {
                    image_prompt: naturalPrompt,
                    image_prompt_positive: positivePrompt,
                    image_prompt_negative: negativePrompt,
                }
            );
            setHasChanges(false);
            setSaveSuccess(true);
            // Clear success message after 2 seconds
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (err) {
            console.error('Failed to save image prompts:', err);
        } finally {
            setIsSaving(false);
        }
    };

    const handleAIAssist = () => {
        setShowPromptBuilder(true);
    };

    // Handler for when streaming starts
    const handleStreamingStart = useCallback((sessionId: string, mode: PromptMode) => {
        setStreamingSessionId(sessionId);
        setStreamingMode(mode);
        setStreamingError(null);
        // Clear target prompt to show streaming from scratch
        switch (mode) {
            case 'natural': setNaturalPrompt(''); break;
            case 'positive': setPositivePrompt(''); break;
            case 'negative': setNegativePrompt(''); break;
        }
    }, []);

    // Handler for streaming errors
    const handleStreamingError = useCallback((error: string) => {
        setStreamingError(error);
        setStreamingSessionId(null);
        setStreamingMode(null);
    }, []);

    const handlePromptGenerated = (result: { prompt: string; mode: PromptMode }) => {
        // Determine which field to update based on mode from result
        if (result.mode === 'natural') {
            setNaturalPrompt(result.prompt);
        } else if (result.mode === 'positive') {
            setPositivePrompt(result.prompt);
        } else if (result.mode === 'negative') {
            setNegativePrompt(result.prompt);
        }
    };

    const handleClear = (tab: PromptTabType) => {
        if (tab === 'natural') {
            setNaturalPrompt('');
        } else if (tab === 'positive') {
            setPositivePrompt('');
        } else if (tab === 'negative') {
            setNegativePrompt('');
        }
    };

    // Compute streaming states for UI
    const isStreamingNatural = streamingSessionId !== null && streamingMode === 'natural';
    const isStreamingPositive = streamingSessionId !== null && streamingMode === 'positive';
    const isStreamingNegative = streamingSessionId !== null && streamingMode === 'negative';
    const isStreaming = streamingSessionId !== null;

    const isLoading = loading[objectId];
    const error = errors[objectId];

    if (!object && isLoading) {
        return <div className="image-prompt-manager loading">Loading...</div>;
    }

    return (
        <div className="image-prompt-manager">
            <div className="prompt-manager-header">
                <h3>Image Prompts for {objectName}</h3>
                <p className="prompt-manager-description">
                    Save reusable prompts for generating images of this {objectType}.
                    Natural language prompts work with OpenAI, Gemini, and xAI.
                    Tag-based prompts work with NovelAI.
                </p>
            </div>

            {error && (
                <div className="error-banner">
                    {error}
                </div>
            )}

            <div className="prompt-tabs">
                <button
                    className={`prompt-tab ${activeTab === 'natural' ? 'active' : ''}`}
                    onClick={() => setActiveTab('natural')}
                >
                    Natural Language
                    {naturalPrompt && <span className="tab-indicator">*</span>}
                </button>
                <button
                    className={`prompt-tab ${activeTab === 'positive' ? 'active' : ''}`}
                    onClick={() => setActiveTab('positive')}
                >
                    Positive Tags
                    {positivePrompt && <span className="tab-indicator">*</span>}
                </button>
                <button
                    className={`prompt-tab ${activeTab === 'negative' ? 'active' : ''}`}
                    onClick={() => setActiveTab('negative')}
                >
                    Negative Tags
                    {negativePrompt && <span className="tab-indicator">*</span>}
                </button>
            </div>

            <div className="prompt-content">
                {activeTab === 'natural' && (
                    <div className="prompt-section">
                        <div className="prompt-section-header">
                            <label>Natural Language Prompt</label>
                            <div className="prompt-actions">
                                <TextButton
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleAIAssist}
                                    title="Generate prompt with AI assistance"
                                    disabled={isStreaming}
                                >
                                    {isStreamingNatural ? 'Generating...' : 'AI Assist'}
                                </TextButton>
                                {naturalPrompt && !isStreamingNatural && (
                                    <TextButton
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleClear('natural')}
                                        title="Clear prompt"
                                    >
                                        Clear
                                    </TextButton>
                                )}
                            </div>
                        </div>
                        {/* Thinking display during streaming */}
                        {isStreamingNatural && streamingSession && (
                            <ThinkingDisplay
                                messageId={streamingSessionId!}
                                contentParts={streamingSession.contentParts}
                                isStreaming={streamingSession.status === 'running'}
                            />
                        )}
                        <textarea
                            value={naturalPrompt}
                            onChange={(e) => !isStreamingNatural && setNaturalPrompt(e.target.value)}
                            placeholder="Describe the image in natural language. This works with OpenAI (DALL-E), Gemini, and xAI (Grok)..."
                            rows={6}
                            className={`prompt-textarea ${isStreamingNatural ? 'streaming' : ''}`}
                            readOnly={isStreamingNatural}
                        />
                        <p className="prompt-hint">
                            Example: "A detailed portrait with dramatic lighting, looking determined, wearing formal attire"
                        </p>
                    </div>
                )}

                {activeTab === 'positive' && (
                    <div className="prompt-section">
                        <div className="prompt-section-header">
                            <label>Positive Tags (NovelAI)</label>
                            <div className="prompt-actions">
                                <TextButton
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleAIAssist}
                                    title="Generate prompt with AI assistance"
                                    disabled={isStreaming}
                                >
                                    {isStreamingPositive ? 'Generating...' : 'AI Assist'}
                                </TextButton>
                                {positivePrompt && !isStreamingPositive && (
                                    <TextButton
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleClear('positive')}
                                        title="Clear prompt"
                                    >
                                        Clear
                                    </TextButton>
                                )}
                            </div>
                        </div>
                        {/* Thinking display during streaming */}
                        {isStreamingPositive && streamingSession && (
                            <ThinkingDisplay
                                messageId={streamingSessionId!}
                                contentParts={streamingSession.contentParts}
                                isStreaming={streamingSession.status === 'running'}
                            />
                        )}
                        <textarea
                            value={positivePrompt}
                            onChange={(e) => !isStreamingPositive && setPositivePrompt(e.target.value)}
                            placeholder="Enter comma-separated tags for NovelAI. These describe what you want in the image..."
                            rows={6}
                            className={`prompt-textarea ${isStreamingPositive ? 'streaming' : ''}`}
                            readOnly={isStreamingPositive}
                        />
                        <p className="prompt-hint">
                            Example: "1girl, solo, long hair, blue eyes, formal dress, detailed face, masterpiece, best quality"
                        </p>
                    </div>
                )}

                {activeTab === 'negative' && (
                    <div className="prompt-section">
                        <div className="prompt-section-header">
                            <label>Negative Tags (NovelAI)</label>
                            <div className="prompt-actions">
                                <TextButton
                                    variant="secondary"
                                    size="sm"
                                    onClick={handleAIAssist}
                                    title="Generate prompt with AI assistance"
                                    disabled={isStreaming}
                                >
                                    {isStreamingNegative ? 'Generating...' : 'AI Assist'}
                                </TextButton>
                                {negativePrompt && !isStreamingNegative && (
                                    <TextButton
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleClear('negative')}
                                        title="Clear prompt"
                                    >
                                        Clear
                                    </TextButton>
                                )}
                            </div>
                        </div>
                        {/* Thinking display during streaming */}
                        {isStreamingNegative && streamingSession && (
                            <ThinkingDisplay
                                messageId={streamingSessionId!}
                                contentParts={streamingSession.contentParts}
                                isStreaming={streamingSession.status === 'running'}
                            />
                        )}
                        <textarea
                            value={negativePrompt}
                            onChange={(e) => !isStreamingNegative && setNegativePrompt(e.target.value)}
                            placeholder="Enter comma-separated tags for things to avoid in the image..."
                            rows={6}
                            className={`prompt-textarea ${isStreamingNegative ? 'streaming' : ''}`}
                            readOnly={isStreamingNegative}
                        />
                        <p className="prompt-hint">
                            Example: "lowres, bad anatomy, bad hands, missing fingers, extra digits, blurry"
                        </p>
                    </div>
                )}
            </div>

            <div className="prompt-manager-footer">
                <div className="status-area">
                    {hasChanges && <span className="unsaved-indicator">Unsaved changes</span>}
                    {saveSuccess && <span className="save-success">Saved!</span>}
                </div>
                <TextButton
                    variant="primary"
                    onClick={handleSave}
                    disabled={isSaving || !hasChanges}
                    loading={isSaving}
                >
                    Save Prompts
                </TextButton>
            </div>

            {/* Streaming error display */}
            {streamingError && (
                <div className="error-banner">
                    {streamingError}
                </div>
            )}

            {/* AI Prompt Builder Modal */}
            <UnifiedImagePromptModal
                isOpen={showPromptBuilder}
                onClose={() => setShowPromptBuilder(false)}
                onPromptGenerated={handlePromptGenerated}
                onStreamingStart={handleStreamingStart}
                onStreamingError={handleStreamingError}
                contextType={isCoverImage ? 'cover_image' : 'object'}
                objectType={isCoverImage ? undefined : objectType as 'character' | 'location' | 'organization' | 'lorebook'}
                objectId={isCoverImage ? undefined : objectId}
                basicInfoId={isCoverImage ? objectId : undefined}
                promptMode={activeTab}
            />
        </div>
    );
};

export default ImagePromptManager;

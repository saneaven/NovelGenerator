import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useObjectQuery } from '../../data/objects/useObjectQuery';
import { useUpdateImagePromptMutation } from '../../data/objects/mutations/useUpdateImagePromptMutation';
import { useJourneyStore } from '../../store/journeyStore';
import { useSettings } from '../../data/settings';
import UnifiedImagePromptModal, { type PromptMode } from '../ImageGeneration/UnifiedImagePromptModal';
import ThinkingDisplay from '../common/ThinkingDisplay';
import PreexistingLiveRunNotice from '../common/PreexistingLiveRunNotice';
import { useThreadLiveViewState } from '../../hooks/useThreadLiveViewState';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import { getMergedThreadMessages, getMergedThreadView } from '../../data/threads';
import { isPausedLikeThreadStatus } from '../../types/thread';
import type { ObjectType, StoryEntityKind } from '../../types/unifiedObject';
import { TextButton } from '../TextButton';
import './ImagePromptManager.css';

interface ImagePromptManagerProps {
    objectType: string;
    objectId: string;
}

type PromptTabType = PromptMode;

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
    const messages = getMergedThreadMessages(threadId);
    const lastAssistantMsg = [...messages].reverse().find((message) => message.role === 'assistant');
    if (!lastAssistantMsg) return '';

    const finalText = extractPromptTextFromData(lastAssistantMsg.data);
    if (finalText) return finalText;

    const toolCalls = getMergedThreadView(threadId).getToolCallsForAssistantMessage(lastAssistantMsg.id);
    for (const toolCall of toolCalls) {
        const promptFromArguments = readPromptValue((toolCall.arguments as Record<string, unknown> | undefined)?.prompt);
        if (promptFromArguments) return promptFromArguments;
        const promptFromResult = readPromptValue((toolCall.result as Record<string, unknown> | null | undefined)?.prompt);
        if (promptFromResult) return promptFromResult;
    }

    return '';
}

const ImagePromptManager: React.FC<ImagePromptManagerProps> = ({
    objectType,
    objectId,
}) => {
    const settings = useSettings();
    const objectQuery = useObjectQuery(objectType as ObjectType, objectId, settings.mainLanguage);
    const updateImagePromptMutation = useUpdateImagePromptMutation();

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
    const previousStreamingStatusRef = useRef<'running' | 'done' | 'halted' | null>(null);

    const journeyThreadId = useJourneyStore((state) =>
        streamingSessionId ? state.journeys[streamingSessionId]?.threadId : undefined
    );
    const streamingThreadStatus = useThreadStreamStore((state) =>
        journeyThreadId ? state.threadsById[journeyThreadId]?.status : undefined
    );
    const streamingThreadError = useThreadStreamStore((state) =>
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
                setNaturalPrompt((prev) => (prev === nextPrompt ? prev : nextPrompt));
                break;
            case 'positive':
                setPositivePrompt((prev) => (prev === nextPrompt ? prev : nextPrompt));
                break;
            case 'negative':
                setNegativePrompt((prev) => (prev === nextPrompt ? prev : nextPrompt));
                break;
        }
    }, []);

    // Get object from query
    const object = objectQuery.data ?? null;
    const objectKind = object?.type === 'story_entity' ? object.kind : undefined;
    const objectMetadata = object?.metadata;

    // Get object name for display (use title for basic_info, name for others)
    const objectName = useMemo(() => {
        if (!object) return 'Loading...';
        const data = object.data && typeof object.data === 'object' && !Array.isArray(object.data)
            ? object.data as Record<string, any>
            : {};
        return (objectType === 'basic_info' ? data.title : data.name) || 'Unnamed';
    }, [object, objectType, settings.mainLanguage]);

    // Load initial values from object metadata
    useEffect(() => {
        if (objectMetadata) {
            const newNatural = objectMetadata.image_prompt || '';
            const newPositive = objectMetadata.image_prompt_positive || '';
            const newNegative = objectMetadata.image_prompt_negative || '';

            setNaturalPrompt(newNatural);
            setPositivePrompt(newPositive);
            setNegativePrompt(newNegative);
            setHasChanges(false);
        }
    }, [object?.id, objectMetadata]);

    // Track changes
    useEffect(() => {
        if (!objectMetadata) return;

        const origNatural = objectMetadata.image_prompt || '';
        const origPositive = objectMetadata.image_prompt_positive || '';
        const origNegative = objectMetadata.image_prompt_negative || '';

        const changed =
            naturalPrompt !== origNatural ||
            positivePrompt !== origPositive ||
            negativePrompt !== origNegative;

        setHasChanges(changed);
    }, [naturalPrompt, positivePrompt, negativePrompt, objectMetadata]);

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

    const handleSave = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            await updateImagePromptMutation.mutateAsync({
                type: objectType as ObjectType,
                id: objectId,
                prompts: {
                    image_prompt: naturalPrompt,
                    image_prompt_positive: positivePrompt,
                    image_prompt_negative: negativePrompt,
                },
            });
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
        previousStreamingStatusRef.current = null;
        setStreamingSessionId(sessionId);
        setStreamingMode(mode);
        setStreamingError(null);
        // Clear target prompt to show streaming from scratch
        applyPromptForMode(mode, '');
    }, [applyPromptForMode]);

    // Handler for streaming errors
    const handleStreamingError = useCallback((error: string) => {
        previousStreamingStatusRef.current = null;
        setStreamingError(error);
        setStreamingSessionId(null);
        setStreamingMode(null);
    }, []);

    const handlePromptGenerated = (result: { prompt: string; mode: PromptMode }) => {
        applyPromptForMode(result.mode, result.prompt);
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

    const isLoading = objectQuery.isLoading;
    const error = objectQuery.error ? (objectQuery.error.message || 'Failed to fetch object') : null;

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
                        <textarea
                            value={naturalPrompt}
                            onChange={(e) => !isStreamingNatural && setNaturalPrompt(e.target.value)}
                            placeholder="Describe the image in natural language. This works with OpenAI, Gemini, and xAI (Grok)..."
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
                        {isStreamingPositive && streamingStatus && (
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
                        {isStreamingNegative && streamingStatus && (
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
                contextType="object"
                objectType={objectType as 'basic_info' | 'story_entity'}
                objectKind={objectKind as StoryEntityKind | undefined}
                objectId={objectId}
                promptMode={activeTab}
            />
        </div>
    );
};

export default ImagePromptManager;

import React, { useState, useEffect, useMemo } from 'react';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettingsStore } from '../../store/settingsStore';
import ImagePromptBuilderModal, { type PromptMode } from '../ImageGeneration/ImagePromptBuilderModal';
import type { ObjectType } from '../../types/unifiedObject';
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

    // Get object from store
    const object = useMemo(() => {
        return getObject(objectId);
    }, [objectId, objects, getObject]);

    // Get object name for display
    const objectName = useMemo(() => {
        if (!object) return 'Loading...';
        const data = object.data[settings.mainLanguage] || Object.values(object.data)[0] || {};
        return data.name || 'Unnamed';
    }, [object, settings.mainLanguage]);

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

    const handleSave = async () => {
        setIsSaving(true);
        setSaveSuccess(false);
        try {
            await updateImagePrompt(
                objectType as ObjectType,
                objectId,
                {
                    image_prompt: naturalPrompt || undefined,
                    image_prompt_positive: positivePrompt || undefined,
                    image_prompt_negative: negativePrompt || undefined,
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

    const handlePromptGenerated = (generatedPrompt: string) => {
        // Determine which field to update based on current tab
        if (activeTab === 'natural') {
            setNaturalPrompt(generatedPrompt);
        } else if (activeTab === 'positive') {
            setPositivePrompt(generatedPrompt);
        } else if (activeTab === 'negative') {
            setNegativePrompt(generatedPrompt);
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
                                <button
                                    className="ai-assist-btn"
                                    onClick={handleAIAssist}
                                    title="Generate prompt with AI assistance"
                                >
                                    AI Assist
                                </button>
                                {naturalPrompt && (
                                    <button
                                        className="clear-btn"
                                        onClick={() => handleClear('natural')}
                                        title="Clear prompt"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                        <textarea
                            value={naturalPrompt}
                            onChange={(e) => setNaturalPrompt(e.target.value)}
                            placeholder="Describe the image in natural language. This works with OpenAI (DALL-E), Gemini, and xAI (Grok)..."
                            rows={6}
                            className="prompt-textarea"
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
                                <button
                                    className="ai-assist-btn"
                                    onClick={handleAIAssist}
                                    title="Generate prompt with AI assistance"
                                >
                                    AI Assist
                                </button>
                                {positivePrompt && (
                                    <button
                                        className="clear-btn"
                                        onClick={() => handleClear('positive')}
                                        title="Clear prompt"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                        <textarea
                            value={positivePrompt}
                            onChange={(e) => setPositivePrompt(e.target.value)}
                            placeholder="Enter comma-separated tags for NovelAI. These describe what you want in the image..."
                            rows={6}
                            className="prompt-textarea"
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
                                <button
                                    className="ai-assist-btn"
                                    onClick={handleAIAssist}
                                    title="Generate prompt with AI assistance"
                                >
                                    AI Assist
                                </button>
                                {negativePrompt && (
                                    <button
                                        className="clear-btn"
                                        onClick={() => handleClear('negative')}
                                        title="Clear prompt"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                        <textarea
                            value={negativePrompt}
                            onChange={(e) => setNegativePrompt(e.target.value)}
                            placeholder="Enter comma-separated tags for things to avoid in the image..."
                            rows={6}
                            className="prompt-textarea"
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
                <button
                    className="save-btn"
                    onClick={handleSave}
                    disabled={isSaving || !hasChanges}
                >
                    {isSaving ? 'Saving...' : 'Save Prompts'}
                </button>
            </div>

            {/* AI Prompt Builder Modal */}
            <ImagePromptBuilderModal
                isOpen={showPromptBuilder}
                onClose={() => setShowPromptBuilder(false)}
                onPromptGenerated={handlePromptGenerated}
                objectType={objectType}
                objectId={objectId}
                promptMode={activeTab}
            />
        </div>
    );
};

export default ImagePromptManager;

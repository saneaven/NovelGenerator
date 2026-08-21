import React, { useEffect, useMemo, useState } from 'react';
import { useObjectQuery } from '../../data/objects/useObjectQuery';
import { useUpdateImagePromptMutation } from '../../data/objects/mutations/useUpdateImagePromptMutation';
import { useJourneyStore } from '../../store/journeyStore';
import { useSettings } from '../../data/settings';
import UnifiedImagePromptModal from '../ImageGeneration/UnifiedImagePromptModal';
import NovelAICharacterPromptCards from '../ImageGeneration/NovelAICharacterPromptCards';
import ThinkingDisplay from '../common/ThinkingDisplay';
import PreexistingLiveRunNotice from '../common/PreexistingLiveRunNotice';
import { useThreadLiveViewState } from '../../hooks/useThreadLiveViewState';
import type { ImagePromptResult, PromptFormat, StoredImagePrompts } from '../../domain/imagePrompt';
import { createEmptyStoredImagePrompts, normalizeStoredImagePrompts } from '../../domain/imagePrompt';
import type { ObjectType, StoryEntityKind } from '../../types/unifiedObject';
import { TextButton } from '../TextButton';
import './ImagePromptManager.css';

interface ImagePromptManagerProps {
  objectType: string;
  objectId: string;
}

const FORMAT_LABELS: Record<PromptFormat, string> = {
  natural: 'Natural Language',
  positive_negative: 'Positive / Negative',
  novelai: 'NovelAI',
};

const ImagePromptManager: React.FC<ImagePromptManagerProps> = ({ objectType, objectId }) => {
  const settings = useSettings();
  const objectQuery = useObjectQuery(objectType as ObjectType, objectId, settings.mainLanguage);
  const updateImagePromptMutation = useUpdateImagePromptMutation();

  const [prompts, setPrompts] = useState<StoredImagePrompts>(createEmptyStoredImagePrompts);
  const [activeFormat, setActiveFormat] = useState<PromptFormat>('natural');
  const [showPromptBuilder, setShowPromptBuilder] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [streamingSessionId, setStreamingSessionId] = useState<string | null>(null);
  const [streamingFormat, setStreamingFormat] = useState<PromptFormat | null>(null);
  const [streamingError, setStreamingError] = useState<string | null>(null);

  const object = objectQuery.data ?? null;
  const objectKind = object?.type === 'story_entity' ? object.kind : undefined;
  const savedPrompts = useMemo(
    () => normalizeStoredImagePrompts(object?.metadata?.image_prompts),
    [object?.metadata?.image_prompts],
  );
  const savedPromptsFingerprint = JSON.stringify(savedPrompts);
  const promptsFingerprint = JSON.stringify(prompts);
  const hasChanges = promptsFingerprint !== savedPromptsFingerprint;

  useEffect(() => {
    setPrompts(savedPrompts);
  }, [object?.id, savedPrompts]);

  const objectName = useMemo(() => {
    if (!object) return 'Loading...';
    const data = object.data && typeof object.data === 'object' && !Array.isArray(object.data)
      ? object.data as Record<string, unknown>
      : {};
    const name = objectType === 'basic_info' ? data.title : data.name;
    return typeof name === 'string' && name ? name : 'Unnamed';
  }, [object, objectType]);

  const journeyThreadId = useJourneyStore((state) => (
    streamingSessionId ? state.journeys[streamingSessionId]?.threadId : undefined
  ));
  const liveView = useThreadLiveViewState(journeyThreadId ?? null);
  const isSuppressedStreaming = Boolean(streamingSessionId && liveView?.deliveryMode === 'suppressed');

  const applyGeneratedPrompt = (result: ImagePromptResult) => {
    setPrompts((current) => {
      if (result.promptFormat === 'natural') {
        return { ...current, natural: { prompt: result.prompt } };
      }
      if (result.promptFormat === 'positive_negative') {
        return {
          ...current,
          positive_negative: { positive: result.positive, negative: result.negative },
        };
      }
      return {
        ...current,
        novelai: {
          positive: result.positive,
          negative: result.negative,
          characters: result.characters,
        },
      };
    });
    setStreamingSessionId(null);
    setStreamingFormat(null);
  };

  const clearFormat = (promptFormat: PromptFormat) => {
    setPrompts((current) => {
      if (promptFormat === 'natural') return { ...current, natural: { prompt: '' } };
      if (promptFormat === 'positive_negative') {
        return { ...current, positive_negative: { positive: '', negative: '' } };
      }
      return { ...current, novelai: { positive: '', negative: '', characters: [] } };
    });
  };

  const formatHasContent = (promptFormat: PromptFormat): boolean => {
    if (promptFormat === 'natural') return Boolean(prompts.natural.prompt);
    if (promptFormat === 'positive_negative') {
      return Boolean(prompts.positive_negative.positive || prompts.positive_negative.negative);
    }
    return Boolean(prompts.novelai.positive || prompts.novelai.negative || prompts.novelai.characters.length);
  };

  const handleSave = async () => {
    setSaveSuccess(false);
    try {
      await updateImagePromptMutation.mutateAsync({
        type: objectType as ObjectType,
        id: objectId,
        prompts,
      });
      setSaveSuccess(true);
      window.setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) {
      console.error('Failed to save image prompts:', error);
    }
  };

  const isLoading = objectQuery.isLoading;
  const queryError = objectQuery.error ? (objectQuery.error.message || 'Failed to fetch object') : null;
  const isStreamingActiveFormat = streamingSessionId !== null && streamingFormat === activeFormat;

  if (!object && isLoading) {
    return <div className="image-prompt-manager loading">Loading...</div>;
  }

  return (
    <div className="image-prompt-manager">
      <div className="prompt-manager-header">
        <h3>Image Prompts for {objectName}</h3>
        <p className="prompt-manager-description">
          Save reusable prompts for natural-language, positive/negative, and NovelAI image models.
        </p>
      </div>

      {queryError ? <div className="error-banner">{queryError}</div> : null}
      {streamingError ? <div className="error-banner">{streamingError}</div> : null}

      <div className="prompt-tabs">
        {(Object.keys(FORMAT_LABELS) as PromptFormat[]).map((promptFormat) => (
          <button
            key={promptFormat}
            className={`prompt-tab ${activeFormat === promptFormat ? 'active' : ''}`}
            onClick={() => setActiveFormat(promptFormat)}
          >
            {FORMAT_LABELS[promptFormat]}
            {formatHasContent(promptFormat) ? <span className="tab-indicator">*</span> : null}
          </button>
        ))}
      </div>

      <div className="prompt-content">
        <div className="prompt-section">
          <div className="prompt-section-header">
            <label>{FORMAT_LABELS[activeFormat]} Prompt</label>
            <div className="prompt-actions">
              <TextButton
                variant="secondary"
                size="sm"
                onClick={() => setShowPromptBuilder(true)}
                title="Generate this complete prompt format with AI assistance"
                disabled={streamingSessionId !== null}
              >
                {isStreamingActiveFormat ? 'Generating...' : 'AI Assist'}
              </TextButton>
              {formatHasContent(activeFormat) && !isStreamingActiveFormat ? (
                <TextButton variant="ghost" size="sm" onClick={() => clearFormat(activeFormat)}>
                  Clear
                </TextButton>
              ) : null}
            </div>
          </div>

          {isStreamingActiveFormat ? (
            isSuppressedStreaming ? (
              <PreexistingLiveRunNotice />
            ) : (
              <ThinkingDisplay
                messageId={streamingSessionId!}
                reasoningDetail={liveView?.reasoningDetail}
                isStreaming
              />
            )
          ) : null}

          {activeFormat === 'natural' ? (
            <textarea
              value={prompts.natural.prompt}
              onChange={(event) => setPrompts((current) => ({
                ...current,
                natural: { prompt: event.target.value },
              }))}
              placeholder="Describe the image in natural language..."
              rows={6}
              className="prompt-textarea"
              disabled={isStreamingActiveFormat}
            />
          ) : null}

          {activeFormat === 'positive_negative' ? (
            <div className="prompt-pair-fields">
              <label>
                <span>Positive Prompt</span>
                <textarea
                  value={prompts.positive_negative.positive}
                  onChange={(event) => setPrompts((current) => ({
                    ...current,
                    positive_negative: { ...current.positive_negative, positive: event.target.value },
                  }))}
                  placeholder="What the image should include..."
                  rows={6}
                  className="prompt-textarea"
                  disabled={isStreamingActiveFormat}
                />
              </label>
              <label>
                <span>Negative Prompt</span>
                <textarea
                  value={prompts.positive_negative.negative}
                  onChange={(event) => setPrompts((current) => ({
                    ...current,
                    positive_negative: { ...current.positive_negative, negative: event.target.value },
                  }))}
                  placeholder="What the image should avoid..."
                  rows={6}
                  className="prompt-textarea"
                  disabled={isStreamingActiveFormat}
                />
              </label>
            </div>
          ) : null}

          {activeFormat === 'novelai' ? (
            <>
              <div className="prompt-pair-fields">
                <label>
                  <span>Base Positive Prompt</span>
                  <textarea
                    value={prompts.novelai.positive}
                    onChange={(event) => setPrompts((current) => ({
                      ...current,
                      novelai: { ...current.novelai, positive: event.target.value },
                    }))}
                    placeholder="Base scene and quality tags..."
                    rows={5}
                    className="prompt-textarea"
                    disabled={isStreamingActiveFormat}
                  />
                </label>
                <label>
                  <span>Base Negative Prompt</span>
                  <textarea
                    value={prompts.novelai.negative}
                    onChange={(event) => setPrompts((current) => ({
                      ...current,
                      novelai: { ...current.novelai, negative: event.target.value },
                    }))}
                    placeholder="Base undesired content..."
                    rows={5}
                    className="prompt-textarea"
                    disabled={isStreamingActiveFormat}
                  />
                </label>
              </div>
              <NovelAICharacterPromptCards
                characters={prompts.novelai.characters}
                onChange={(characters) => setPrompts((current) => ({
                  ...current,
                  novelai: { ...current.novelai, characters },
                }))}
                disabled={isStreamingActiveFormat}
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="prompt-manager-footer">
        <div className="status-area">
          {hasChanges ? <span className="unsaved-indicator">Unsaved changes</span> : null}
          {saveSuccess ? <span className="save-success">Saved!</span> : null}
        </div>
        <TextButton
          variant="primary"
          onClick={handleSave}
          disabled={updateImagePromptMutation.isPending || !hasChanges}
          loading={updateImagePromptMutation.isPending}
        >
          Save Prompts
        </TextButton>
      </div>

      <UnifiedImagePromptModal
        isOpen={showPromptBuilder}
        onClose={() => setShowPromptBuilder(false)}
        onPromptGenerated={applyGeneratedPrompt}
        onStreamingStart={(sessionId, promptFormat) => {
          setStreamingSessionId(sessionId);
          setStreamingFormat(promptFormat);
          setStreamingError(null);
        }}
        onStreamingError={(error) => {
          setStreamingError(error);
          setStreamingSessionId(null);
          setStreamingFormat(null);
        }}
        contextType="object"
        objectType={objectType as 'basic_info' | 'story_entity'}
        objectKind={objectKind as StoryEntityKind | undefined}
        objectId={objectId}
        promptFormat={activeFormat}
      />
    </div>
  );
};

export default ImagePromptManager;

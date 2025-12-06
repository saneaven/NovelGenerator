import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useLLMToast } from '../../hooks/useLLMToast';
import { LLMTask, LLMTaskMode, type ObjectImagePromptContext } from '../../llm';
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
  promptMode?: PromptMode;
  defaultUserRequest?: string;
}

const ImagePromptBuilderModal: React.FC<ImagePromptBuilderModalProps> = ({
  isOpen,
  onClose,
  onPromptGenerated,
  objectType,
  objectId,
  promptMode = 'natural',
  defaultUserRequest,
}) => {
  const { settings } = useSettingsStore();
  const unifiedStore = useUnifiedObjectStore();

  const [userRequest, setUserRequest] = useState(defaultUserRequest || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPrompt, setGeneratedPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const sessionId = `image-prompt-${objectId}`;
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRef = useRef<LLMTask | null>(null);

  const { startTask, completeSuccess, completeError } = useLLMToast({
    sessionId,
    taskType: 'image-prompt',
    label: 'Image Prompt Generation',
  });

  const objectData = objectId ? unifiedStore.objects[objectId] : null;

  const targetObject = useMemo((): TargetObject | null => {
    if (!objectId || !objectData) return null;
    const data = objectData.data[settings.mainLanguage] || Object.values(objectData.data)[0] || {};
    return { id: objectData.id, name: data.name || '', description: data.description || '' };
  }, [objectId, objectData, settings.mainLanguage]);

  const savedPrompts = useMemo(() => {
    if (!objectData?.metadata) return null;
    return {
      natural: objectData.metadata.image_prompt || null,
      positive: objectData.metadata.image_prompt_positive || null,
      negative: objectData.metadata.image_prompt_negative || null,
    };
  }, [objectData]);

  useEffect(() => {
    if (!isOpen) {
      setUserRequest('');
      setGeneratedPrompt('');
      setError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      taskRef.current?.abort();
    };
  }, []);

  const getContextTypeLabel = (): string => {
    const labels: Record<string, string> = {
      character: 'Character',
      location: 'Location',
      organization: 'Organization',
      lorebook: 'Lorebook Entry',
    };
    return labels[objectType] || '';
  };

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    setError(null);
    setGeneratedPrompt('');

    startTask({
      taskType: 'image-prompt',
      modalProps: { objectType, objectId, onPromptGenerated, promptMode },
      formState: { userRequest },
    });

    onClose();

    const imagePromptConfig = settings.functionConfigs.imagePrompt;
    const providerConfig = settings.providerCredentials[imagePromptConfig.provider];
    const isNativeOutput = settings.nativeOutputMode;

    const objectInfo = targetObject
      ? `**${targetObject.name}**\n${targetObject.description}`
      : '';

    const promptContext: ObjectImagePromptContext = {
      userInput: userRequest,
      promptMode,
      objectType,
      objectInfo,
      currentPrompt: savedPrompts?.natural || null,
      currentPromptPositive: savedPrompts?.positive || null,
      currentPromptNegative: savedPrompts?.negative || null,
      isNativeOutput,
      outputLanguage: settings.mainLanguage,
      enablePrefill: imagePromptConfig.advanced.enablePrefill,
      enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
    };

    try {
      taskRef.current = new LLMTask(
        {
          mode: LLMTaskMode.OBJECT_IMAGE_PROMPT,
          projectId: '',
          promptContext,
          abortControllerRef,
          sessionId,
          provider: imagePromptConfig.provider,
          providerConfig,
          model: imagePromptConfig.model,
          temperature: imagePromptConfig.temperature,
          thinkingMode: imagePromptConfig.advanced.thinkingMode as any,
          thinkingConfig: imagePromptConfig.advanced.thinkingConfig,
          retryConfig: settings.retryConfig,
        },
        {
          onUpdate: () => {},
          onComplete: (result) => {
            if (isNativeOutput) {
              const text = result.contentParts.filter(part => part.type === 'content').map(part => part.text).join('');
              if (text.trim()) {
                onPromptGenerated(text.trim());
                completeSuccess();
              } else {
                const errorMsg = 'AI did not generate a prompt.';
                setError(errorMsg);
                completeError(errorMsg);
              }
            } else {
              const call = result.functionCalls.find(c => c.function_name === 'generate_object_image_prompt');
              if (call?.arguments) {
                try {
                  const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
                  if (args.prompt) {
                    onPromptGenerated(args.prompt);
                    completeSuccess();
                  }
                } catch {
                  const errorMsg = 'Failed to parse generated prompt.';
                  setError(errorMsg);
                  completeError(errorMsg);
                }
              } else {
                const text = result.contentParts.filter(part => part.type === 'content').map(part => part.text).join('');
                if (text.trim()) {
                  onPromptGenerated(text.trim());
                  completeSuccess();
                } else {
                  const errorMsg = 'AI did not generate a prompt.';
                  setError(errorMsg);
                  completeError(errorMsg);
                }
              }
            }
          },
          onError: (err) => {
            if (err.name === 'AbortError') return;
            const errorMsg = err.message || 'Failed to generate prompt';
            setError(errorMsg);
            completeError(errorMsg);
          },
        }
      );

      await taskRef.current.run();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate prompt';
      setError(errorMsg);
      completeError(errorMsg);
    } finally {
      setIsGenerating(false);
      taskRef.current = null;
    }
  }, [settings, targetObject, savedPrompts, promptMode, objectType, objectId, userRequest, sessionId, startTask, onPromptGenerated, completeSuccess, completeError, onClose]);

  const handleUsePrompt = () => {
    onPromptGenerated(generatedPrompt);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content image-prompt-builder-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>AI-Assisted Image Prompt Generator</h2>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        <div className="modal-body">
          <div className="context-indicator">
            <span className="context-type">{getContextTypeLabel()}:</span>
            <span className="context-name">{targetObject?.name || 'Loading...'}</span>
          </div>

          <div className="form-group">
            <label htmlFor="user-request">What do you want to visualize?</label>
            <textarea
              id="user-request"
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder='e.g., "A dramatic portrait looking determined"'
              rows={3}
              disabled={isGenerating}
            />
          </div>

          <div className="generate-section">
            <button className="generate-button" onClick={handleGenerate} disabled={isGenerating}>
              {isGenerating ? 'Generating...' : 'Generate Prompt'}
            </button>
          </div>

          {error && <div className="error-message">{error}</div>}

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

        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary" disabled={isGenerating}>Cancel</button>
          <button onClick={handleUsePrompt} className="btn-primary" disabled={!generatedPrompt.trim() || isGenerating}>
            Use This Prompt
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImagePromptBuilderModal;

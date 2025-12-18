import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { BaseModal } from '../BaseModal';
import { useSettingsStore } from '../../store/settingsStore';
import { useProjectStore } from '../../store/projectStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { LLMTask, LLMTaskMode, LLMTaskManager, type ObjectImagePromptContext } from '../../llm';
import { TextButton } from '../TextButton';
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
  const { currentProjectId } = useProjectStore();
  const unifiedStore = useUnifiedObjectStore();

  const [userRequest, setUserRequest] = useState(defaultUserRequest || '');

  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRef = useRef<LLMTask | null>(null);

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
    // Start task via LLMTaskManager - returns a handle with bound completion functions
    const task = LLMTaskManager.startTask({
      taskType: 'image-prompt',
      label: 'Image Prompt Generation',
      retryContext: {
        taskType: 'image-prompt',
        modalProps: { objectType, objectId, onPromptGenerated, promptMode },
        formState: { userRequest },
      },
    });

    onClose();

    const imagePromptConfig = settings.functionConfigs.imagePrompt;
    const providerConfig = settings.providerCredentials[imagePromptConfig.provider];
    const isNativeOutput = settings.nativeOutputMode;

    const objectInfo = targetObject
      ? `**${targetObject.name}**\n${targetObject.description}`
      : '';

    if (!currentProjectId) {
      throw new Error('Project ID is required');
    }

    const promptContext: ObjectImagePromptContext = {
      userInput: userRequest,
      projectId: currentProjectId,
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
          projectId: currentProjectId,
          promptContext,
          abortControllerRef,
          sessionId: task.sessionId,
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
                task.complete();
              } else {
                task.error('AI did not generate a prompt.');
              }
            } else {
              const call = result.functionCalls.find(c => c.function_name === 'generate_object_image_prompt');
              if (call?.arguments) {
                try {
                  const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
                  if (args.prompt) {
                    onPromptGenerated(args.prompt);
                    task.complete();
                  }
                } catch {
                  task.error('Failed to parse generated prompt.');
                }
              } else {
                const text = result.contentParts.filter(part => part.type === 'content').map(part => part.text).join('');
                if (text.trim()) {
                  onPromptGenerated(text.trim());
                  task.complete();
                } else {
                  task.error('AI did not generate a prompt.');
                }
              }
            }
          },
          onError: (err) => {
            if (err.name === 'AbortError') {
              task.cancel();
            } else {
              task.error(err.message || 'Failed to generate prompt');
            }
          },
        }
      );

      await taskRef.current.run();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        task.cancel();
        return;
      }
      task.error(err instanceof Error ? err.message : 'Failed to generate prompt');
    } finally {
      taskRef.current = null;
    }
  }, [settings, targetObject, savedPrompts, promptMode, objectType, objectId, userRequest, onPromptGenerated, onClose]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="small"
      title="AI-Assisted Image Prompt Generator"
      className="image-prompt-builder-modal"
      zIndexLayer={1}
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose}>
            Cancel
          </TextButton>
          <TextButton variant="primary" onClick={handleGenerate}>
            Generate Prompt
          </TextButton>
        </>
      }
    >
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
          />
        </div>
      </div>
    </BaseModal>
  );
};

export default ImagePromptBuilderModal;

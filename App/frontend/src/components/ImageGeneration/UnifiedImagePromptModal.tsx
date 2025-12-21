/**
 * UnifiedImagePromptModal - Unified modal for AI-assisted image prompt generation
 * Handles three context types: object, cover_image, and scene
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { BaseModal } from '../BaseModal';
import { useProjectStore } from '../../store/projectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import {
  LLMTask,
  LLMTaskMode,
  LLMTaskManager,
  type ObjectImagePromptContext,
  type SceneImagePromptContext,
  type CoverImagePromptContext,
  type SelectedObjectContext,
} from '../../llm';
import { TextButton } from '../TextButton';
import { ObjectPicker } from '../ObjectPicker';
import './UnifiedImagePromptModal.css';

export type PromptMode = 'natural' | 'positive' | 'negative';
export type ContextType = 'object' | 'cover_image' | 'scene';

export interface PromptResult {
  prompt: string;
  mode: PromptMode;
}

interface SceneContext {
  preContext: string;
  postContext: string;
}

interface UnifiedImagePromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPromptGenerated: (result: PromptResult) => void;
  promptMode: PromptMode;

  // Context type determines which UI/LLM mode to use
  contextType: ContextType;

  // For 'object' context
  objectType?: 'character' | 'location' | 'organization' | 'lorebook';
  objectId?: string;

  // For 'cover_image' context (saved as basic_info's image)
  basicInfoId?: string;

  // For 'scene' context
  sceneContext?: SceneContext;

  // Optional default values
  defaultUserRequest?: string;
}

const UnifiedImagePromptModal: React.FC<UnifiedImagePromptModalProps> = ({
  isOpen,
  onClose,
  onPromptGenerated,
  promptMode,
  contextType,
  objectType,
  objectId,
  basicInfoId,
  sceneContext,
  defaultUserRequest,
}) => {
  const { currentProjectId } = useProjectStore();
  const { settings } = useSettingsStore();
  const unifiedStore = useUnifiedObjectStore();

  const [userRequest, setUserRequest] = useState(defaultUserRequest || '');
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRef = useRef<LLMTask | null>(null);

  // Get object data for 'object' context
  const objectData = objectId ? unifiedStore.objects[objectId] : null;
  const targetObject = useMemo(() => {
    if (contextType !== 'object' || !objectId || !objectData) return null;
    const data = objectData.data[settings.mainLanguage] || Object.values(objectData.data)[0] || {};
    return { id: objectData.id, name: data.name || '', description: data.description || '' };
  }, [contextType, objectId, objectData, settings.mainLanguage]);

  // Get basic info data for 'cover_image' context
  const basicInfoData = useMemo(() => {
    if (contextType !== 'cover_image') return null;
    // Find basic_info object from the objects map
    const basicInfoObj = Object.values(unifiedStore.objects).find(obj => obj.type === 'basic_info');
    if (!basicInfoObj) return null;
    const data = basicInfoObj.data[settings.mainLanguage] || Object.values(basicInfoObj.data)[0] || {};
    return {
      id: basicInfoObj.id,
      title: data.title || '',
      logline: data.logline || '',
      genre: data.genre || '',
      metadata: basicInfoObj.metadata,
    };
  }, [contextType, unifiedStore.objects, settings.mainLanguage]);

  // Get saved prompts based on context type
  const savedPrompts = useMemo(() => {
    if (contextType === 'object' && objectData?.metadata) {
      return {
        natural: objectData.metadata.image_prompt || null,
        positive: objectData.metadata.image_prompt_positive || null,
        negative: objectData.metadata.image_prompt_negative || null,
      };
    }
    if (contextType === 'cover_image' && basicInfoData?.metadata) {
      return {
        natural: basicInfoData.metadata.image_prompt || null,
        positive: basicInfoData.metadata.image_prompt_positive || null,
        negative: basicInfoData.metadata.image_prompt_negative || null,
      };
    }
    return null;
  }, [contextType, objectData, basicInfoData]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUserRequest('');
      setSelectedObjectIds([]);
    }
  }, [isOpen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      taskRef.current?.abort();
    };
  }, []);

  // Build selected objects from store for LLM context
  const selectedObjects = useMemo((): SelectedObjectContext[] => {
    const results: SelectedObjectContext[] = [];

    for (const id of selectedObjectIds) {
      const obj = unifiedStore.objects[id];
      if (!obj) continue;

      const data = obj.data[settings.mainLanguage] || Object.values(obj.data)[0] || {};

      // Get saved image prompt based on mode
      let imagePrompt: string | undefined;
      if (obj.metadata) {
        switch (promptMode) {
          case 'natural': imagePrompt = obj.metadata.image_prompt || undefined; break;
          case 'positive': imagePrompt = obj.metadata.image_prompt_positive || undefined; break;
          case 'negative': imagePrompt = obj.metadata.image_prompt_negative || undefined; break;
        }
      }

      results.push({
        id: obj.id,
        type: obj.type as string,
        name: (data.name || data.title || '') as string,
        description: (data.description || data.logline || '') as string,
        imagePrompt,
      });
    }

    return results;
  }, [selectedObjectIds, unifiedStore.objects, settings.mainLanguage, promptMode]);

  const getModalTitle = (): string => {
    switch (contextType) {
      case 'object': return 'AI-Assisted Image Prompt Generator';
      case 'cover_image': return 'AI Cover Image Prompt Generator';
      case 'scene': return 'AI Scene Prompt Assistant';
    }
  };

  const getContextLabel = (): string => {
    if (contextType === 'object' && objectType) {
      const labels: Record<string, string> = {
        character: 'Character',
        location: 'Location',
        organization: 'Organization',
        lorebook: 'Lorebook Entry',
      };
      return labels[objectType] || '';
    }
    return '';
  };

  const getPromptModeLabel = (): string => {
    switch (promptMode) {
      case 'natural': return 'Natural Language';
      case 'positive': return 'Positive Tags';
      case 'negative': return 'Negative Tags';
    }
  };

  const handleGenerate = useCallback(async () => {
    if (!currentProjectId) {
      console.error('Project ID is required');
      return;
    }

    const imagePromptConfig = settings.functionConfigs.imagePrompt;
    const providerConfig = settings.providerCredentials[imagePromptConfig.provider];
    const isNativeOutput = settings.nativeOutputMode;

    // Determine task type and label based on context
    const taskType = contextType === 'scene' ? 'scene-image' : 'image-prompt';
    const taskLabel = contextType === 'scene' ? 'Scene Prompt Generation' :
                      contextType === 'cover_image' ? 'Cover Image Prompt Generation' :
                      'Image Prompt Generation';

    // Start task via LLMTaskManager
    const task = LLMTaskManager.startTask({
      taskType,
      label: taskLabel,
      retryContext: {
        taskType,
        modalProps: { contextType, objectType, objectId, basicInfoId, sceneContext, promptMode },
        formState: { userRequest, selectedObjectIds },
      },
    });

    onClose();

    // Build context and mode based on contextType
    let llmMode: typeof LLMTaskMode[keyof typeof LLMTaskMode];
    let promptContext: ObjectImagePromptContext | SceneImagePromptContext | CoverImagePromptContext;

    if (contextType === 'object') {
      const objectInfo = targetObject
        ? `**${targetObject.name}**\n${targetObject.description}`
        : '';

      llmMode = LLMTaskMode.OBJECT_IMAGE_PROMPT;
      promptContext = {
        userInput: userRequest,
        projectId: currentProjectId,
        promptMode,
        objectType: objectType!,
        objectInfo,
        currentPrompt: savedPrompts?.natural || null,
        currentPromptPositive: savedPrompts?.positive || null,
        currentPromptNegative: savedPrompts?.negative || null,
        isNativeOutput,
        outputLanguage: settings.mainLanguage,
        enablePrefill: imagePromptConfig.advanced.enablePrefill,
        enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
      } as ObjectImagePromptContext;
    } else if (contextType === 'cover_image') {
      llmMode = LLMTaskMode.COVER_IMAGE_PROMPT;
      promptContext = {
        userInput: userRequest,
        projectId: currentProjectId,
        promptMode,
        basicInfo: {
          title: basicInfoData?.title || '',
          logline: basicInfoData?.logline || '',
          genre: basicInfoData?.genre || '',
        },
        selectedObjects,
        currentPrompt: savedPrompts?.natural || null,
        currentPromptPositive: savedPrompts?.positive || null,
        currentPromptNegative: savedPrompts?.negative || null,
        isNativeOutput: true,
        outputLanguage: settings.mainLanguage,
        enablePrefill: imagePromptConfig.advanced.enablePrefill,
        enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
      } as CoverImagePromptContext;
    } else {
      // scene context
      llmMode = LLMTaskMode.SCENE_IMAGE_PROMPT;
      promptContext = {
        userInput: userRequest,
        projectId: currentProjectId,
        promptMode,
        scenePreContext: sceneContext?.preContext || '',
        scenePostContext: sceneContext?.postContext || '',
        selectedObjects,
        isNativeOutput: true,
        outputLanguage: settings.mainLanguage,
        enablePrefill: imagePromptConfig.advanced.enablePrefill,
        enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
      } as SceneImagePromptContext;
    }

    try {
      taskRef.current = new LLMTask(
        {
          mode: llmMode,
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
            // For cover_image and scene, always use native output
            if (contextType === 'cover_image' || contextType === 'scene' || isNativeOutput) {
              const text = result.contentParts
                .filter(part => part.type === 'content')
                .map(part => part.text)
                .join('');

              if (text.trim()) {
                onPromptGenerated({ prompt: text.trim(), mode: promptMode });
                task.complete();
              } else {
                task.error('AI did not generate a prompt.');
              }
            } else {
              // For object context with function call mode
              const call = result.functionCalls.find(c => c.function_name === 'generate_object_image_prompt');
              if (call?.arguments) {
                try {
                  const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;
                  if (args.prompt) {
                    onPromptGenerated({ prompt: args.prompt, mode: promptMode });
                    task.complete();
                  }
                } catch {
                  task.error('Failed to parse generated prompt.');
                }
              } else {
                const text = result.contentParts.filter(part => part.type === 'content').map(part => part.text).join('');
                if (text.trim()) {
                  onPromptGenerated({ prompt: text.trim(), mode: promptMode });
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
  }, [
    settings,
    currentProjectId,
    contextType,
    objectType,
    objectId,
    targetObject,
    basicInfoData,
    sceneContext,
    selectedObjects,
    savedPrompts,
    userRequest,
    promptMode,
    selectedObjectIds,
    onClose,
    onPromptGenerated,
  ]);

  const showObjectPicker = contextType === 'cover_image' || contextType === 'scene';

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size={showObjectPicker ? 'medium' : 'small'}
      title={getModalTitle()}
      className="unified-image-prompt-modal"
      zIndexLayer={1}
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose}>Cancel</TextButton>
          <TextButton variant="primary" onClick={handleGenerate}>Generate Prompt</TextButton>
        </>
      }
    >
      <div className="modal-body">
        {/* Prompt mode indicator (for cover_image and scene) */}
        {(contextType === 'cover_image' || contextType === 'scene') && (
          <div className="prompt-mode-indicator">
            <span className="mode-label">Generating:</span>
            <span className="mode-value">{getPromptModeLabel()}</span>
          </div>
        )}

        {/* Context indicator based on type */}
        {contextType === 'object' && (
          <div className="context-indicator">
            <span className="context-type">{getContextLabel()}:</span>
            <span className="context-name">{targetObject?.name || 'Loading...'}</span>
          </div>
        )}

        {contextType === 'cover_image' && (
          <div className="context-indicator cover-image">
            <span className="context-type">Cover Image for:</span>
            <span className="context-name">{basicInfoData?.title || 'Your Novel'}</span>
          </div>
        )}

        {contextType === 'scene' && sceneContext && (
          <div className="context-preview">
            <span className="context-label">Scene Context</span>
            {sceneContext.preContext && (
              <div className="context-snippet">
                <strong>Before:</strong> {sceneContext.preContext.slice(0, 100)}...
              </div>
            )}
            {sceneContext.postContext && (
              <div className="context-snippet">
                <strong>After:</strong> {sceneContext.postContext.slice(0, 100)}...
              </div>
            )}
          </div>
        )}

        {/* Object picker for cover_image and scene - uses mode="story-objects" to auto-fetch */}
        {showObjectPicker && (
          <div className="form-group object-context-section">
            <label>Include Story Objects</label>
            <span className="section-hint">
              {contextType === 'cover_image'
                ? 'Select objects to inform the cover design'
                : 'Uncheck objects you don\'t want to include'}
            </span>
            <ObjectPicker
              mode="story-objects"
              projectId={currentProjectId || ''}
              language={settings.mainLanguage}
              selectedIds={selectedObjectIds}
              onChange={(ids) => setSelectedObjectIds(Array.isArray(ids) ? ids : [ids])}
              selectionMode="multi"
              maxHeight="200px"
              showSearch={false}
            />
            <div className="selection-summary">
              {selectedObjectIds.length} objects selected
            </div>
          </div>
        )}

        {/* User request textarea */}
        <div className="form-group">
          <label htmlFor="user-request">What do you want to visualize?</label>
          <textarea
            id="user-request"
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            placeholder={
              contextType === 'object'
                ? 'e.g., "A dramatic portrait looking determined"'
                : contextType === 'cover_image'
                ? 'e.g., "An epic fantasy cover with magical elements"'
                : 'e.g., "A dramatic moment showing the characters facing each other"'
            }
            rows={3}
          />
        </div>
      </div>
    </BaseModal>
  );
};

export default UnifiedImagePromptModal;

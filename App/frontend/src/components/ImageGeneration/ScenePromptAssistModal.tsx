/**
 * ScenePromptAssistModal - Modal for AI-assisted scene image prompt generation
 */

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { BaseModal } from '../BaseModal';
import { useProjectStore } from '../../store/projectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { LLMTask, LLMTaskMode, LLMTaskManager, type SceneImagePromptContext, type SelectedObjectContext } from '../../llm';
import { TextButton } from '../TextButton';
import { ObjectPicker } from '../ObjectPicker';
import type { ObjectPickerGroup } from '../ObjectPicker/types';
import './ScenePromptAssistModal.css';

export type PromptMode = 'natural' | 'positive' | 'negative';

export interface PromptResult {
  prompt: string;
  mode: PromptMode;
}

interface SceneContext {
  preContext: string;
  postContext: string;
}

interface ImageReferenceObject {
  id: string;
  name: string;
  type: string;
  description?: string;
  metadata?: {
    image_prompt?: string;
    image_prompt_positive?: string;
    image_prompt_negative?: string;
  };
}

interface ScenePromptAssistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPromptGenerated: (result: PromptResult) => void;
  sceneContext: SceneContext;
  promptMode: PromptMode;
  allStoryObjects: ImageReferenceObject[];
}

const getSavedImagePrompt = (obj: ImageReferenceObject, mode: PromptMode): string | undefined => {
  if (!obj.metadata) return undefined;
  switch (mode) {
    case 'natural': return obj.metadata.image_prompt;
    case 'positive': return obj.metadata.image_prompt_positive;
    case 'negative': return obj.metadata.image_prompt_negative;
  }
};

const ScenePromptAssistModal: React.FC<ScenePromptAssistModalProps> = ({
  isOpen,
  onClose,
  onPromptGenerated,
  sceneContext,
  promptMode,
  allStoryObjects,
}) => {
  const { currentProjectId } = useProjectStore();
  const { settings } = useSettingsStore();

  const [userRequest, setUserRequest] = useState('');
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRef = useRef<LLMTask | null>(null);

  // Initialize with all objects selected when modal opens
  useEffect(() => {
    if (allStoryObjects.length > 0) {
      const allIds = allStoryObjects.map(o => `${o.type}:${o.id}`);
      setSelectedObjectIds(allIds);
    }
  }, [allStoryObjects]);

  // Build ObjectPicker groups from flat allStoryObjects array
  const storyObjectGroups = useMemo((): ObjectPickerGroup[] => {
    const groups: ObjectPickerGroup[] = [];

    const characters = allStoryObjects.filter(o => o.type === 'character');
    if (characters.length > 0) {
      groups.push({
        id: 'characters',
        label: 'Characters',
        type: 'character',
        items: characters.map(c => ({
          id: `character:${c.id}`,
          name: c.name,
          type: 'character',
        })),
      });
    }

    const locations = allStoryObjects.filter(o => o.type === 'location');
    if (locations.length > 0) {
      groups.push({
        id: 'locations',
        label: 'Locations',
        type: 'location',
        items: locations.map(l => ({
          id: `location:${l.id}`,
          name: l.name,
          type: 'location',
        })),
      });
    }

    const organizations = allStoryObjects.filter(o => o.type === 'organization');
    if (organizations.length > 0) {
      groups.push({
        id: 'organizations',
        label: 'Organizations',
        type: 'organization',
        items: organizations.map(o => ({
          id: `organization:${o.id}`,
          name: o.name,
          type: 'organization',
        })),
      });
    }

    const lorebook = allStoryObjects.filter(o => o.type === 'lorebook');
    if (lorebook.length > 0) {
      groups.push({
        id: 'lorebook',
        label: 'Lorebook',
        type: 'lorebook',
        items: lorebook.map(l => ({
          id: `lorebook:${l.id}`,
          name: l.name,
          type: 'lorebook',
        })),
      });
    }

    return groups;
  }, [allStoryObjects]);

  // Convert selected prefixed IDs back to objects for LLM context
  const selectedObjects = useMemo(() => {
    return selectedObjectIds
      .map(prefixedId => {
        const [type, id] = prefixedId.split(':');
        return allStoryObjects.find(o => o.id === id && o.type === type);
      })
      .filter((obj): obj is ImageReferenceObject => obj !== undefined);
  }, [selectedObjectIds, allStoryObjects]);

  const getPromptModeLabel = (): string => {
    switch (promptMode) {
      case 'natural': return 'Natural Language';
      case 'positive': return 'Positive Tags';
      case 'negative': return 'Negative Tags';
    }
  };

  const handleGenerate = useCallback(async () => {
    // Start task via LLMTaskManager - returns a handle with bound completion functions
    const task = LLMTaskManager.startTask({
      taskType: 'scene-image',
      label: 'Scene Prompt Generation',
      retryContext: {
        taskType: 'scene-image',
        modalProps: { sceneContext, allStoryObjects, onPromptGenerated, promptMode },
        formState: { userRequest, selectedObjectIds },
      },
    });

    onClose();

    const imagePromptConfig = settings.functionConfigs.imagePrompt;
    const providerConfig = settings.providerCredentials[imagePromptConfig.provider];

    const selectedObjectContexts: SelectedObjectContext[] = selectedObjects.map(obj => ({
      id: obj.id,
      type: obj.type,
      name: obj.name,
      description: obj.description || '',
      imagePrompt: getSavedImagePrompt(obj, promptMode),
    }));

    if (!currentProjectId) {
      throw new Error('Project ID is required');
    }

    const promptContext: SceneImagePromptContext = {
      userInput: userRequest,
      projectId: currentProjectId,
      promptMode,
      scenePreContext: sceneContext.preContext,
      scenePostContext: sceneContext.postContext,
      selectedObjects: selectedObjectContexts,
      isNativeOutput: true,
      outputLanguage: settings.mainLanguage,
      enablePrefill: imagePromptConfig.advanced.enablePrefill,
      enableThinking: imagePromptConfig.advanced.thinkingMode === 'model',
      enableCustomThinking: imagePromptConfig.advanced.thinkingMode === 'custom',
    };

    try {
      taskRef.current = new LLMTask(
        {
          mode: LLMTaskMode.SCENE_IMAGE_PROMPT,
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
    sceneContext,
    allStoryObjects,
    selectedObjects,
    userRequest,
    promptMode,
    selectedObjectIds,
    onClose,
    onPromptGenerated,
  ]);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="medium"
      title="AI Scene Prompt Assistant"
      className="scene-prompt-assist-modal"
      zIndexLayer={1}
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose}>Cancel</TextButton>
          <TextButton variant="primary" onClick={handleGenerate}>Generate Prompt</TextButton>
        </>
      }
    >
      <div className="modal-body">
          <div className="prompt-mode-indicator">
            <span className="mode-label">Generating:</span>
            <span className="mode-value">{getPromptModeLabel()}</span>
          </div>

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

          {storyObjectGroups.length > 0 && (
            <div className="form-group object-context-section">
              <label>Include Story Objects</label>
              <span className="section-hint">Uncheck objects you don't want to include</span>
              <ObjectPicker
                mode="story-objects"
                projectId={currentProjectId || ''}
                language={settings.mainLanguage}
                customGroups={storyObjectGroups}
                selectedIds={selectedObjectIds}
                onChange={(ids) => setSelectedObjectIds(Array.isArray(ids) ? ids : [ids])}
                selectionMode="multi"
                maxHeight="200px"
                showSearch={false}
              />
              <div className="selection-summary">
                {selectedObjects.length} of {allStoryObjects.length} objects selected
              </div>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="user-request">What do you want to visualize?</label>
            <textarea
              id="user-request"
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder='e.g., "A dramatic moment showing the characters facing each other"'
              rows={3}
            />
          </div>
        </div>
    </BaseModal>
  );
};

export default ScenePromptAssistModal;

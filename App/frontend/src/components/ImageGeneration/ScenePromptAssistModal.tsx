/**
 * ScenePromptAssistModal - Modal for AI-assisted scene image prompt generation
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useModalHistory } from '../../hooks/useModalHistory';
import { useProjectStore } from '../../store/projectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { LLMTask, LLMTaskMode, LLMTaskManager, type SceneImagePromptContext, type SelectedObjectContext } from '../../llm';
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
  useModalHistory(isOpen, onClose);
  const { currentProjectId } = useProjectStore();
  const { settings } = useSettingsStore();

  const [userRequest, setUserRequest] = useState('');
  const [excludedObjectIds, setExcludedObjectIds] = useState<Set<string>>(new Set());

  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRef = useRef<LLMTask | null>(null);

  const handleToggleObject = useCallback((objId: string) => {
    setExcludedObjectIds(prev => {
      const next = new Set(prev);
      if (next.has(objId)) next.delete(objId);
      else next.add(objId);
      return next;
    });
  }, []);

  const selectedObjects = useMemo(() =>
    allStoryObjects.filter(obj => !excludedObjectIds.has(obj.id)),
    [allStoryObjects, excludedObjectIds]
  );

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
        formState: { userRequest, excludedObjectIds: Array.from(excludedObjectIds) },
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

    const promptContext: SceneImagePromptContext = {
      userInput: userRequest,
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
          projectId: currentProjectId || '',
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
    excludedObjectIds,
    onClose,
    onPromptGenerated,
  ]);

  if (!isOpen) return null;

  return (
    <div className="scene-prompt-assist-overlay" onClick={onClose}>
      <div className="scene-prompt-assist-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>AI Scene Prompt Assistant</h3>
          <button className="close-btn" onClick={onClose}>x</button>
        </div>

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

          {allStoryObjects.length > 0 && (
            <div className="form-group object-context-section">
              <label>Include Story Objects</label>
              <span className="section-hint">Uncheck objects you don't want to include</span>
              <div className="object-context-list">
                {allStoryObjects.map(obj => {
                  const isChecked = !excludedObjectIds.has(obj.id);
                  const savedPrompt = getSavedImagePrompt(obj, promptMode);
                  return (
                    <label key={obj.id} className={`object-checkbox-item ${isChecked ? 'checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => handleToggleObject(obj.id)}
                      />
                      <span className={`object-type-badge ${obj.type}`}>{obj.type}</span>
                      <span className="object-name">{obj.name}</span>
                      {savedPrompt && <span className="has-prompt-badge" title="Has saved image prompt">P</span>}
                      <span className="object-preview">
                        {obj.description ? obj.description.slice(0, 40) + '...' : '(no description)'}
                      </span>
                    </label>
                  );
                })}
              </div>
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

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleGenerate}>Generate Prompt</button>
        </div>
      </div>
    </div>
  );
};

export default ScenePromptAssistModal;

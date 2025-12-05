/**
 * ScenePromptAssistModal - Modal for AI-assisted scene image prompt generation
 *
 * Opens from SceneImageGeneratorModal when user clicks "AI Assist" button.
 * User selects which story objects to include in the LLM context via checkboxes.
 * promptMode is passed from parent based on current provider/tab.
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useLLMTaskStore } from '../../store/llmTaskStore';
import { LLMRequestManager } from '../../chat/sessions/LLMRequestManager';
import { LLMRequestPipeline } from '../../chat/LLMRequestPipeline';
import type { SceneImagePromptContext, ImageReferenceObject } from '../../chat/managers/SystemPromptManager';
import { useLLMToast } from '../../hooks/useLLMToast';
import { generateTempId } from '../../utils/tempId';
import './ScenePromptAssistModal.css';

export type PromptMode = 'natural' | 'positive' | 'negative';

/** Result passed to onPromptGenerated callback - includes mode to avoid closure issues */
export interface PromptResult {
  prompt: string;
  mode: PromptMode;
}

interface SceneContext {
  preContext: string;
  postContext: string;
}

interface ScenePromptAssistModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Callback receives prompt with the mode it was generated for (avoids closure capture issues) */
  onPromptGenerated: (result: PromptResult) => void;
  sceneContext: SceneContext;
  /** promptMode is passed from parent based on provider/tab, NOT selected inside this modal */
  promptMode: PromptMode;
  allStoryObjects: ImageReferenceObject[];
}

const createSessionId = () => `scene-prompt-assist-${generateTempId()}`;

/**
 * Get saved image prompt from object metadata based on promptMode
 */
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

  // Form state
  const [userRequest, setUserRequest] = useState('');

  // Track excluded objects (all are checked/included by default)
  const [excludedObjectIds, setExcludedObjectIds] = useState<Set<string>>(new Set());

  // Session ID for toast
  const sessionIdRef = useRef<string | undefined>(undefined);
  if (!sessionIdRef.current) {
    sessionIdRef.current = createSessionId();
  }
  const sessionId = sessionIdRef.current;

  // Toast notification
  const { startTask, completeSuccess, completeError, completeCancelled } = useLLMToast({
    sessionId,
    taskType: 'scene-image',
    label: 'Scene Prompt Generation',
  });

  // LLM Task store for status updates
  const updateSession = useLLMTaskStore((state) => state.updateSession);

  // Request state refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const taskRunnerRef = useRef<LLMRequestManager | null>(null);

  // Get native output mode setting
  const isNativeOutput = settings.nativeOutputMode;

  // Toggle handler for checkbox
  const handleToggleObject = useCallback((objId: string) => {
    setExcludedObjectIds(prev => {
      const next = new Set(prev);
      if (next.has(objId)) {
        next.delete(objId);  // Re-check (include)
      } else {
        next.add(objId);     // Uncheck (exclude)
      }
      return next;
    });
  }, []);

  // Get selected objects (all except excluded)
  const selectedObjects = useMemo(() =>
    allStoryObjects.filter(obj => !excludedObjectIds.has(obj.id)),
    [allStoryObjects, excludedObjectIds]
  );

  // Get prompt mode display name
  const getPromptModeLabel = (): string => {
    switch (promptMode) {
      case 'natural': return 'Natural Language';
      case 'positive': return 'Positive Tags';
      case 'negative': return 'Negative Tags';
    }
  };

  const handleGenerate = useCallback(async () => {
    // Start toast notification with retry context
    startTask({
      taskType: 'scene-image',
      modalProps: {
        sceneContext,
        allStoryObjects,
        onPromptGenerated,
        promptMode,
      },
      formState: {
        userRequest,
        excludedObjectIds: Array.from(excludedObjectIds),
      },
    });

    // Auto-close modal - request continues in background
    onClose();

    const imagePromptConfig = settings.functionConfigs.imagePrompt;
    const providerConfig = settings.providerCredentials[imagePromptConfig.provider];

    try {
      // Build SceneImagePromptContext with selected objects (user-chosen, not AI-chosen)
      const promptContext: SceneImagePromptContext = {
        userRequest,
        promptMode,
        scenePreContext: sceneContext.preContext,
        scenePostContext: sceneContext.postContext,
        // NEW: selectedObjects with full context including saved image prompts
        selectedObjects: selectedObjects.map(obj => ({
          id: obj.id,
          type: obj.type,
          name: obj.name,
          description: obj.description || '',
          imagePrompt: getSavedImagePrompt(obj, promptMode),
        })),
        isNativeOutput,
      };

      const systemInsertConfig = {
        enabled: true,
        includeProjectInfo: false,
        includeStoryObjects: false,
        includeNovelContent: false,
        promptType: 'sceneImagePrompt' as const,
        promptContext,
      };

      // No function calling - just generate text prompt directly
      taskRunnerRef.current = new LLMRequestManager(
        {
          projectId: currentProjectId || '',
          getStoryObjects: () => ({}),
          systemInsertConfig,
          chatPipeline: new LLMRequestPipeline(),
          provider: imagePromptConfig.provider,
          providerConfig,
          aiModel: imagePromptConfig.model,
          temperature: imagePromptConfig.temperature,
          mode: 'workspace',
          enablePrefill: imagePromptConfig.advanced.enablePrefill,
          thinkingMode: imagePromptConfig.advanced.thinkingMode,
          thinkingConfig: imagePromptConfig.advanced.thinkingConfig,
          retryConfig: settings.retryConfig,
          abortControllerRef,
          sessionId,
          // No function calling - native output only
        },
        {
          onStreamUpdate: () => {}, // Store is now updated by LLMRequestManager internally
          onFinalMessage: async (message) => {
            const text = message.contentParts
              ?.filter(part => part.type === 'content')
              .map(part => part.text)
              .join('') || '';

            if (text.trim()) {
              // Pass mode along with prompt to avoid closure capture issues
              onPromptGenerated({ prompt: text.trim(), mode: promptMode });
              updateSession(sessionId, { status: 'success' });
              completeSuccess();
            } else {
              const errorMsg = 'AI did not generate a prompt. Please try again.';
              updateSession(sessionId, { status: 'error', error: errorMsg });
              completeError(errorMsg);
            }
          },
          onError: (err) => {
            if (err.name === 'AbortError') {
              updateSession(sessionId, { status: 'cancelled' });
              completeCancelled();
              return;
            }
            console.error('Failed to generate scene prompt:', err);
            const errorMsg = err.message || 'Failed to generate prompt';
            updateSession(sessionId, { status: 'error', error: errorMsg });
            completeError(errorMsg);
          },
        }
      );

      await taskRunnerRef.current.run(null, {
        history: [],
        language: settings.mainLanguage,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        updateSession(sessionId, { status: 'cancelled' });
        completeCancelled();
        return;
      }
      console.error('Failed to generate scene prompt:', err);
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate prompt';
      updateSession(sessionId, { status: 'error', error: errorMsg });
      completeError(errorMsg);
    } finally {
      taskRunnerRef.current = null;
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
    isNativeOutput,
    sessionId,
    startTask,
    onClose,
    onPromptGenerated,
    updateSession,
    completeSuccess,
    completeError,
    completeCancelled,
  ]);

  const handleClose = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="scene-prompt-assist-overlay" onClick={handleClose}>
      <div className="scene-prompt-assist-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>AI Scene Prompt Assistant</h3>
          <button className="close-btn" onClick={handleClose}>&times;</button>
        </div>

        <div className="modal-body">
          {/* Prompt Mode Indicator */}
          <div className="prompt-mode-indicator">
            <span className="mode-label">Generating:</span>
            <span className="mode-value">{getPromptModeLabel()}</span>
          </div>

          {/* Scene Context Preview */}
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

          {/* Story Object Context Selection */}
          {allStoryObjects.length > 0 && (
            <div className="form-group object-context-section">
              <label>Include Story Objects</label>
              <span className="section-hint">Uncheck objects you don't want to include in the prompt</span>
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

          {/* User Request */}
          <div className="form-group">
            <label htmlFor="user-request">What do you want to visualize?</label>
            <textarea
              id="user-request"
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder='e.g., "A dramatic moment showing the characters facing each other" or "Focus on the emotional tension"'
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={handleGenerate}>
            Generate Prompt
          </button>
        </div>
      </div>
    </div>
  );
};

export default ScenePromptAssistModal;

/**
 * UnifiedImagePromptModal - Unified modal for AI-assisted image prompt generation
 * Handles three context types: object, cover_image, and scene
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { BaseModal } from '../BaseModal';
import { useProjectStore } from '../../store/projectStore';
import { useSettings } from '../../store/settingsStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useJourneyStore } from '../../store/journeyStore';
import { JourneyRuntime } from '../../llmTaskJourney';
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
  onStreamingStart?: (sessionId: string, mode: PromptMode) => void;
  onStreamingError?: (error: string, mode: PromptMode) => void;
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
  defaultSelectedObjectIds?: string[];
}

const UnifiedImagePromptModal: React.FC<UnifiedImagePromptModalProps> = ({
  isOpen,
  onClose,
  onPromptGenerated,
  onStreamingStart,
  onStreamingError,
  promptMode,
  contextType,
  objectType,
  objectId,
  basicInfoId,
  sceneContext,
  defaultUserRequest,
  defaultSelectedObjectIds,
}) => {
  const { currentProjectId } = useProjectStore();
  const settings = useSettings();
  const unifiedStore = useUnifiedObjectStore();

  const [userRequest, setUserRequest] = useState(defaultUserRequest || '');
  const [selectedObjectIds, setSelectedObjectIds] = useState<string[]>(
    defaultSelectedObjectIds ?? []
  );
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Watch journey for status/result (activeSessionId is journeyId)
  // Note: Streaming display should come from llmSessionStore using the returned sessionId.
  const activeJourney = useJourneyStore((state) =>
    activeSessionId ? state.journeys[activeSessionId] : undefined
  );

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

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUserRequest(defaultUserRequest || '');
      setSelectedObjectIds(defaultSelectedObjectIds ?? []);
    }
  }, [isOpen, defaultUserRequest, defaultSelectedObjectIds]);

  useEffect(() => {
    if (!activeSessionId || !activeJourney) return;

    if (activeJourney.status === 'success') {
      const result = activeJourney.result as PromptResult | undefined;
      if (result?.prompt) {
        onPromptGenerated(result);
      } else {
        onStreamingError?.('AI did not generate a prompt.', promptMode);
      }
      setActiveSessionId(null);
      return;
    }

    if (activeJourney.status === 'error') {
      onStreamingError?.(activeJourney.error || 'Failed to generate prompt.', promptMode);
      setActiveSessionId(null);
      return;
    }

    if (activeJourney.status === 'cancelled') {
      setActiveSessionId(null);
    }
  }, [activeSessionId, activeJourney, onPromptGenerated, onStreamingError, promptMode]);

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

  const handleGenerate = useCallback(() => {
    if (!currentProjectId) {
      console.error('Project ID is required');
      return;
    }

    const kind = contextType === 'scene' ? 'sceneImage' : 'imagePrompt';
    const { journeyId, sessionId } = JourneyRuntime.start(kind, {
      projectId: currentProjectId,
      promptMode,
      contextType,
      userRequest,
      objectType,
      objectId,
      basicInfoId,
      sceneContext,
      selectedObjectIds,
    });

    setActiveSessionId(journeyId);
    onStreamingStart?.(sessionId, promptMode);
    onClose();
  }, [
    currentProjectId,
    contextType,
    promptMode,
    userRequest,
    objectType,
    objectId,
    basicInfoId,
    sceneContext,
    selectedObjectIds,
    onStreamingStart,
    onClose,
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
              selectAllOnLoad={!defaultSelectedObjectIds?.length}
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

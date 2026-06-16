/**
 * UnifiedImagePromptModal - Unified modal for AI-assisted image prompt generation
 * Handles two context types: object and scene
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { BaseModal } from '../BaseModal';
import { useProjectStore } from '../../store/projectStore';
import { useSettings } from '../../data/settings';
import { useObjectQuery } from '../../data/objects/useObjectQuery';
import { useJourneyStore } from '../../store/journeyStore';
import { useThreadStreamStore } from '../../store/threadStreamStore';
import { getMergedThreadMessages, getMergedThreadView } from '../../data/threads';
import { getJourneySpec } from '../../llmTaskJourney/journeySpecs';
import { journeyService } from '../../api/journeyService';
import { isPausedLikeThreadStatus } from '../../types/thread';
import type { ObjectType } from '../../types/unifiedObject';
import { TextButton } from '../TextButton';
import { ObjectPicker } from '../ObjectPicker';
import './UnifiedImagePromptModal.css';

export type PromptMode = 'natural' | 'positive' | 'negative';
export type ContextType = 'object' | 'scene';

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
  objectType?: 'basic_info' | 'story_entity';
  objectKind?: 'character' | 'location' | 'organization' | 'lorebook';
  objectId?: string;

  // For 'scene' context
  manuscriptId?: string;
  sceneContext?: SceneContext;

  // Optional default values
  defaultUserRequest?: string;
  defaultSelectedEntityIds?: string[];
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
  objectKind,
  objectId,
  manuscriptId,
  sceneContext,
  defaultUserRequest,
  defaultSelectedEntityIds,
}) => {
  const { currentProjectId } = useProjectStore();
  const settings = useSettings();
  const objectQuery = useObjectQuery(
    (objectType ?? 'story_entity') as ObjectType,
    contextType === 'object' ? objectId : undefined,
    settings.mainLanguage,
  );

  const [userRequest, setUserRequest] = useState(defaultUserRequest || '');
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>(
    defaultSelectedEntityIds ?? []
  );
  const [activeJourneyId, setActiveJourneyId] = useState<string | null>(null);

  // Get threadId from journey metadata
  const journeyThreadId = useJourneyStore((state) =>
    activeJourneyId ? state.journeys[activeJourneyId]?.threadId : undefined
  );
  const journeyError = useJourneyStore((state) =>
    activeJourneyId ? state.journeys[activeJourneyId]?.error : undefined
  );

  // Watch thread for completion
  const threadStatus = useThreadStreamStore((state) =>
    journeyThreadId ? state.threadsById[journeyThreadId]?.status : undefined
  );
  const threadError = useThreadStreamStore((state) =>
    journeyThreadId ? state.threadsById[journeyThreadId]?.lastError : undefined
  );
  const isStreamActive = useThreadStreamStore((state) =>
    journeyThreadId ? Boolean(state.activeStreamByThread[journeyThreadId]) : false
  );

  // Get object data for 'object' context
  const objectData = objectId ? (objectQuery.data ?? null) : null;
  const targetObject = useMemo(() => {
    if (contextType !== 'object' || !objectId || !objectData) return null;
    const data = objectData.data && typeof objectData.data === 'object' && !Array.isArray(objectData.data)
      ? objectData.data as Record<string, any>
      : {};
    // BasicInfo uses title, other objects use name
    const displayName = objectType === 'basic_info' ? data.title : data.name;
    return { id: objectData.id, name: displayName || '' };
  }, [contextType, objectId, objectData, objectType, settings.mainLanguage]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUserRequest(defaultUserRequest || '');
      setSelectedEntityIds(defaultSelectedEntityIds ?? []);
    }
  }, [isOpen, defaultUserRequest, defaultSelectedEntityIds]);

  useEffect(() => {
    if (!activeJourneyId) return;

    // Pre-threadId dispatch error
    if (journeyError) {
      onStreamingError?.(journeyError, promptMode);
      setActiveJourneyId(null);
      return;
    }

    if (!journeyThreadId || !threadStatus) return;

    // Still running
    if (threadStatus === 'running' || isStreamActive) return;

    if (isPausedLikeThreadStatus(threadStatus)) {
      onStreamingError?.(
        threadStatus === 'paused'
          ? 'Prompt generation paused.'
          : (threadError || 'Failed to generate prompt.'),
        promptMode,
      );
      setActiveJourneyId(null);
      return;
    }

    // Completed (done) — extract prompt from last assistant message
    if (threadStatus === 'done') {
      const messages = getMergedThreadMessages(journeyThreadId);
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');

      if (lastAssistantMsg) {
        const data = lastAssistantMsg.data;
        const entry = data[Object.keys(data)[0]];
        const promptText = entry?.contentParts
          ?.filter((p) => p.type === 'content')
          .map((p) => p.text)
          .join('') || '';

        if (promptText) {
          onPromptGenerated({ prompt: promptText, mode: promptMode });
        } else {
          // Try extracting from tool call arguments
          const toolCalls = getMergedThreadView(journeyThreadId).getToolCallsForAssistantMessage(lastAssistantMsg.id);
          const promptFromTool = toolCalls
            .map(tc => (tc.arguments as Record<string, unknown>)?.prompt || (tc.result as Record<string, unknown> | null)?.prompt)
            .find(Boolean) as string | undefined;

          if (promptFromTool) {
            onPromptGenerated({ prompt: promptFromTool, mode: promptMode });
          } else {
            onStreamingError?.('AI did not generate a prompt.', promptMode);
          }
        }
      } else {
        onStreamingError?.('No response received.', promptMode);
      }
      setActiveJourneyId(null);
    }
  }, [activeJourneyId, journeyThreadId, journeyError, threadStatus, threadError, isStreamActive, onPromptGenerated, onStreamingError, promptMode]);

  const getModalTitle = (): string => {
    switch (contextType) {
      case 'object': return 'AI-Assisted Image Prompt Generator';
      case 'scene': return 'AI Scene Prompt Assistant';
    }
  };

  const getContextLabel = (): string => {
    if (contextType === 'object' && objectType) {
      const labels: Record<string, string> = {
        basic_info: 'Basic Info',
        story_entity: objectKind ? `${objectKind[0].toUpperCase()}${objectKind.slice(1)} Entity` : 'Story Entity',
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

    const spec = getJourneySpec('imagePrompt');
    const journeyId = crypto.randomUUID();
    const journeyKind = contextType === 'scene' ? 'sceneImagePrompt' : 'imagePrompt';
    const inputPayload = {
      projectId: currentProjectId,
      promptMode,
      contextType,
      userRequest: userRequest.trim(),
      objectType,
      objectKind,
      objectId,
      manuscriptId,
      sceneContext,
      selectedEntityIds,
      rawMode: true,
      outputMode: 'raw_output' as const,
    };
    useJourneyStore.getState().createJourney({
      id: journeyId,
      kind: journeyKind,
      input: inputPayload,
      editingTargets: spec.buildEditingTargets(inputPayload),
      label: spec.label(inputPayload),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    setActiveJourneyId(journeyId);
    onStreamingStart?.(journeyId, promptMode);

    try {
      const created = await journeyService.create(currentProjectId, {
        kind: journeyKind,
        display_label: spec.label(inputPayload),
        input_text: userRequest.trim() || 'Generate an image prompt.',
        input_payload: inputPayload,
        surface: 'story-entity',
        context_object_ids: selectedEntityIds,
      });
      useJourneyStore.getState().updateJourney(journeyId, { threadId: created.thread_id });
    } catch (error: any) {
      const message = error?.message ?? 'Failed to start image prompt journey.';
      useJourneyStore.getState().updateJourney(journeyId, { error: message });
      onStreamingError?.(message, promptMode);
      setActiveJourneyId(null);
    }

    onClose();
  }, [
    currentProjectId,
    contextType,
    promptMode,
    userRequest,
    objectType,
    objectKind,
    objectId,
    manuscriptId,
    sceneContext,
    selectedEntityIds,
    onStreamingStart,
    onStreamingError,
    onClose,
    promptMode,
  ]);

  const showObjectPicker = contextType === 'scene';

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
        {/* Prompt mode indicator (for scene) */}
        {contextType === 'scene' && (
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

        {/* Object picker for scene - uses mode="story-entities" to auto-fetch */}
        {showObjectPicker && (
          <div className="form-group object-context-section">
            <label>Include Story Entities</label>
            <span className="section-hint">
              Uncheck objects you don&apos;t want to include
            </span>
            <ObjectPicker
              mode="all"
              projectId={currentProjectId || ''}
              language={settings.mainLanguage}
              selectedIds={selectedEntityIds}
              onChange={(ids) => setSelectedEntityIds(Array.isArray(ids) ? ids : [ids])}
              selectionMode="multi"
              maxHeight="200px"
              selectAllOnLoad={!defaultSelectedEntityIds?.length}
            />
            <div className="selection-summary">
              {selectedEntityIds.length} entities selected
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

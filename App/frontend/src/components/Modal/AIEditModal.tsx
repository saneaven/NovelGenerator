import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BaseModal } from '../BaseModal';
import { useProjectObjectsMapState } from '../../data/objects/useProjectObjectsMap';
import { readProjectObjectsFromCache } from '../../data/objects/objectCache';
import { useSettings } from '../../data/settings';
import type { ObjectType, OutlineObject, UnifiedObject } from '../../types/unifiedObject';
import { getJourneySpec } from '../../llmTaskJourney/journeySpecs';
import type { ObjectEditInput } from '../../llmTaskJourney/journeySpecs';
import type { JourneySpec } from '../../llmTaskJourney/types';
import { useJourneyStore } from '../../store/journeyStore';
import { journeyService } from '../../api/journeyService';
import { Document } from '../icons';
import {
  ObjectPicker,
  getAllModeSelectableIds,
  useSharedObjectPickerSelection,
} from '../ObjectPicker';
import { computeParentClosure } from '../../utils/parentClosure';
import { TextButton } from '../TextButton';
import ToggleSwitch from '../common/ToggleSwitch';
import './AIEditModal.css';

type AIEditCategory = ObjectType | 'manuscript';
type AIEditJourneyKind = 'manuscriptEdit' | 'outlineEdit' | 'objectEdit';

interface AIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: AIEditCategory;
  projectId: string;
  targetId?: string;
  onTaskStarted?: (sessionId: string) => void;
  defaultUserRequest?: string;
}

const getCategoryDisplayName = (cat: string): string => {
  const names: Record<string, string> = {
    basic_info: 'Basic Info',
    story_entity: 'Story Entity',
    outline: 'Outline',
    manuscript: 'Manuscript',
  };
  return names[cat] || cat;
};

function categoryToJourneyKind(category: string): AIEditJourneyKind {
  if (category === 'manuscript') return 'manuscriptEdit';
  if (category === 'outline') return 'outlineEdit';
  return 'objectEdit';
}

const AIEditModal: React.FC<AIEditModalProps> = ({
  isOpen,
  onClose,
  category,
  projectId,
  targetId,
  onTaskStarted,
  defaultUserRequest,
}) => {
  // Form state
  const [userRequest, setUserRequest] = useState(defaultUserRequest ?? '');
  const [pickerLoading, setPickerLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawMode, setRawMode] = useState(false);

  const settings = useSettings();

  const isManuscriptMode = category === 'manuscript';
  const editTypeText = 'Item';
  const mainLanguage = settings.mainLanguage;
  const {
    objects: projectObjects,
    isLoading: isContextObjectsLoading,
  } = useProjectObjectsMapState(projectId, mainLanguage);
  const targetOutline = (!isManuscriptMode && category === 'outline' && targetId)
    ? (projectObjects[targetId] as OutlineObject | undefined) ?? null
    : null;
  const categoryDisplayName = targetOutline?.kind
    ? getCategoryDisplayName(targetOutline.kind)
    : getCategoryDisplayName(category);

  // Get item name for title (fetch from query cache)
  const itemName = useMemo(() => {
    if (!targetId) return null;

    if (isManuscriptMode) {
      // For manuscript, targetId is chapterId - get chapter name
      const chapter = projectObjects[targetId] as OutlineObject | undefined;
      if (chapter?.data) {
        const langData = chapter.data as Record<string, any>;
        return langData?.name || null;
      }
      return null;
    }

    // For other categories, get object name
    const obj = projectObjects[targetId];
    if (obj?.data) {
      const langData = obj.data as Record<string, any>;
      return langData?.name || langData?.title || null;
    }
    return null;
  }, [targetId, isManuscriptMode, mainLanguage, projectObjects]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUserRequest(defaultUserRequest ?? '');
      setPickerLoading(true);
      setError(null);
      setRawMode(false);
    }
  }, [isOpen, defaultUserRequest]);

  // Exclude target ID from selection
  const excludedIds = useMemo(() => {
    if (!targetId) return [];

    if (isManuscriptMode) {
      // For manuscript, exclude the manuscript object (not the chapter)
      const manuscriptObj = Object.values(projectObjects).find(
        (obj) => obj.type === 'manuscript' && obj.metadata?.chapter_id === targetId,
      );
      return manuscriptObj ? [manuscriptObj.id] : [];
    }

    return [targetId];
  }, [targetId, isManuscriptMode, projectObjects]);

  const availableContextIds = useMemo(
    () => getAllModeSelectableIds(Object.values(projectObjects)),
    [projectObjects],
  );
  const {
    selectedIds: selectedContextIds,
    setSelectedIds: setSelectedContextIds,
  } = useSharedObjectPickerSelection({
    projectId,
    bucket: 'all-context',
    availableIds: availableContextIds,
    excludedIds,
  });

  const handleContextChange = useCallback((ids: string[] | string) => {
    setSelectedContextIds(Array.isArray(ids) ? ids : [ids]);
  }, [setSelectedContextIds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (isContextObjectsLoading) {
      setError('Context objects are still loading.');
      return;
    }
    const trimmedRequest = userRequest.trim();
    if (!trimmedRequest) {
      setError('Please enter an edit request.');
      return;
    }

    if (!targetId) {
      setError('AI Edit requires a target ID.');
      return;
    }

    const journeyKind = categoryToJourneyKind(category);
    const spec: JourneySpec<ObjectEditInput> = getJourneySpec(journeyKind);
    const journeyId = crypto.randomUUID();
    const outputMode = rawMode
      ? 'raw_output'
      : (settings.nativeOutputMode ? 'native_tool_call' : 'tool_call');
    const inputPayload = {
      projectId,
      category,
      targetId,
      userRequest: trimmedRequest,
      selectedContextIds,
      rawMode,
      outputMode,
    };
    const editingTargets = spec.buildEditingTargets(inputPayload);

    useJourneyStore.getState().createJourney({
      id: journeyId,
      kind: journeyKind,
      input: inputPayload,
      editingTargets,
      label: spec.label(inputPayload),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const objectsById: Record<string, UnifiedObject> = {};
    for (const obj of readProjectObjectsFromCache(projectId)) {
      objectsById[obj.id] = obj;
    }
    const excludedIdSet = new Set(excludedIds);
    const contextObjectIds = computeParentClosure(selectedContextIds, objectsById)
      .filter((id) => !excludedIdSet.has(id));

    try {
      const created = await journeyService.create(projectId, {
        kind: journeyKind,
        display_label: spec.label(inputPayload),
        input_text: trimmedRequest,
        input_payload: inputPayload,
        surface: 'story-entity',
        journey_target_ids: [targetId],
        context_object_ids: contextObjectIds,
      });
      useJourneyStore.getState().updateJourney(journeyId, { threadId: created.thread_id });
    } catch (error: any) {
      useJourneyStore.getState().updateJourney(journeyId, {
        error: error?.message ?? 'Failed to start AI edit journey',
      });
    }

    onTaskStarted?.(journeyId);

    // Close modal immediately - task continues in background via toast
    onClose();
  };

  const renderContent = () => {
    const placeholderText = itemName
      ? `Enter your edit request for "${itemName}".`
      : `Enter your edit request for the ${categoryDisplayName} ${editTypeText}.`;

    return (
      <form id="ai-edit-form" onSubmit={handleSubmit} className="ai-edit-form">
        <div className="form-group">
          <label htmlFor="user-request">Edit Request</label>
          <textarea
            id="user-request"
            value={userRequest}
            onChange={(e) => setUserRequest(e.target.value)}
            placeholder={placeholderText}
            rows={4}
            required
          />
        </div>

        <div className="form-group raw-mode-toggle">
          <ToggleSwitch
            checked={rawMode}
            onChange={setRawMode}
            label="Raw output mode"
            icon={<Document size="sm" />}
          />
          <p className="field-hint">
            Output text directly without tool calls. Replaces content for the selected object or full chapter text for manuscripts.
          </p>
        </div>

        <div className="form-group">
          <label>Context Options</label>
          <div className="context-selector">
            <ObjectPicker
              mode="all"
              selectionMode="multi"
              selectedIds={selectedContextIds}
              onChange={handleContextChange}
              projectId={projectId}
              language={mainLanguage}
              excludedIds={excludedIds}
              onLoadComplete={() => setPickerLoading(false)}
              showSearch={true}
              maxHeight="300px"
              emptyMessage="No context objects available"
            />
          </div>
          <p className="context-help">
            Select individual objects to include as context for the AI.
          </p>
        </div>
      </form>
    );
  };

  const renderFooter = () => {
    return (
      <>
        {error && <div className="confirmation-error" style={{ flex: 1, color: 'var(--color-error)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}
        <TextButton variant="secondary" onClick={onClose}>
          Cancel
        </TextButton>
        <TextButton
          variant="primary"
          type="submit"
          form="ai-edit-form"
          disabled={!userRequest.trim() || pickerLoading || isContextObjectsLoading}
        >
          Request AI Edit
        </TextButton>
      </>
    );
  };

  const getTitle = () => {
    const titleParts = [`AI ${categoryDisplayName} ${editTypeText} Edit`];
    if (itemName) {
      titleParts.push(`: ${itemName}`);
    }
    return titleParts.join('');
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="large"
      title={getTitle()}
      className="ai-edit-modal"
      footer={renderFooter()}
    >
      {renderContent()}
    </BaseModal>
  );
};

export default AIEditModal;

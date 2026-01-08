import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BaseModal } from './BaseModal';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { ObjectType, ChapterObject } from '../types/unifiedObject';
import { TaskRuntime } from '../llmTask';
import { Expand, Collapse, Document } from './icons';
import { ObjectPicker } from './ObjectPicker';
import { TextButton } from './TextButton';
import ToggleSwitch from './ToggleSwitch';
import './AIEditModal.css';

type AIEditCategory = ObjectType | 'manuscript';

interface AIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: AIEditCategory;
  projectId: string;
  targetId?: string;
  onTaskStarted?: (sessionId: string) => void;
  defaultUserRequest?: string;
  defaultSelectedContextIds?: string[];
}

const getCategoryDisplayName = (cat: string): string => {
  const names: Record<string, string> = {
    basic_info: 'Basic Info',
    character: 'Character',
    organization: 'Organization',
    location: 'Location',
    lorebook: 'Lorebook',
    outline: 'Outline',
    act: 'Act',
    chapter: 'Chapter',
    manuscript: 'Manuscript',
  };
  return names[cat] || cat;
};

const AIEditModal: React.FC<AIEditModalProps> = ({
  isOpen,
  onClose,
  category,
  projectId,
  targetId,
  onTaskStarted,
  defaultUserRequest,
  defaultSelectedContextIds,
}) => {
  // Form state
  const [userRequest, setUserRequest] = useState(defaultUserRequest ?? '');
  const [selectedContextIds, setSelectedContextIds] = useState<string[]>(
    defaultSelectedContextIds ?? []
  );
  const [isContextExpanded, setIsContextExpanded] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rawMode, setRawMode] = useState(false);

  const unifiedStore = useUnifiedObjectStore();
  const settingsStore = useSettingsStore();

  const isManuscriptMode = category === 'manuscript';
  const categoryDisplayName = getCategoryDisplayName(category);
  const editTypeText = targetId ? 'Item' : 'All';
  const mainLanguage = settingsStore.settings.mainLanguage;

  // Get item name for title (fetch from store)
  const itemName = useMemo(() => {
    if (!targetId) return null;

    if (isManuscriptMode) {
      // For manuscript, targetId is chapterId - get chapter name
      const chapter = unifiedStore.getObject(targetId) as ChapterObject | null;
      if (chapter?.data) {
        const langData = chapter.data[mainLanguage] || Object.values(chapter.data)[0];
        return langData?.name || null;
      }
      return null;
    }

    // For other categories, get object name
    const obj = unifiedStore.getObject(targetId);
    if (obj?.data) {
      const langData = (obj.data as Record<string, any>)[mainLanguage] || Object.values(obj.data)[0];
      return langData?.name || langData?.title || null;
    }
    return null;
  }, [targetId, isManuscriptMode, mainLanguage, unifiedStore]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUserRequest(defaultUserRequest ?? '');
      setSelectedContextIds(defaultSelectedContextIds ?? []);
      setPickerLoading(true);
      setError(null);
      setRawMode(false);
    }
  }, [isOpen, defaultUserRequest, defaultSelectedContextIds]);

  // Simple handler for context selection
  const handleContextChange = useCallback((ids: string[] | string) => {
    setSelectedContextIds(Array.isArray(ids) ? ids : [ids]);
  }, []);

  // Exclude target ID from selection
  const excludedIds = useMemo(() => {
    if (!targetId) return [];

    if (isManuscriptMode) {
      // For manuscript, exclude the manuscript object (not the chapter)
      const manuscriptObj = unifiedStore.getManuscriptByChapterId(targetId);
      return manuscriptObj ? [manuscriptObj.id] : [];
    }

    return [targetId];
  }, [targetId, isManuscriptMode, unifiedStore]);

  // On picker load complete
  const handlePickerLoadComplete = useCallback(() => {
    setPickerLoading(false);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedRequest = userRequest.trim();
    if (!trimmedRequest) {
      setError('Please enter an edit request.');
      return;
    }

    if (isManuscriptMode && !targetId) {
      setError('Manuscript edit requires a target chapter ID.');
      return;
    }

    const sessionId = TaskRuntime.start('aiEdit', {
      projectId,
      category,
      targetId,
      userRequest: trimmedRequest,
      selectedContextIds,
      rawMode,
    });
    onTaskStarted?.(sessionId);

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
            Output text directly without function calls. Replaces description (story objects) or content (manuscripts).
          </p>
        </div>

        <div className="form-group context-options">
          <div
            className="context-options-header"
            onClick={() => setIsContextExpanded(!isContextExpanded)}
          >
            <span className={`context-options-toggle ${isContextExpanded ? 'expanded' : ''}`}>
              {isContextExpanded ? <Collapse size="xs" /> : <Expand size="xs" />}
            </span>
            <label>Context Inclusion Options</label>
          </div>
          {isContextExpanded && (
            <>
              <div className="context-selector">
                <ObjectPicker
                  mode="all"
                  selectionMode="multi"
                  selectedIds={selectedContextIds}
                  onChange={handleContextChange}
                  projectId={projectId}
                  language={mainLanguage}
                  excludedIds={excludedIds}
                  showSearch={true}
                  maxHeight="300px"
                  emptyMessage="No context objects available"
                  onLoadComplete={handlePickerLoadComplete}
                  selectAllOnLoad={!defaultSelectedContextIds?.length}
                />
              </div>
              <p className="context-help">
                Select individual objects to include as context for the AI.
              </p>
            </>
          )}
        </div>
      </form>
    );
  };

  const renderFooter = () => {
    return (
      <>
        {error && <div className="confirmation-error" style={{ flex: 1, color: 'var(--color-danger)', fontSize: 'var(--font-size-sm)' }}>{error}</div>}
        <TextButton variant="secondary" onClick={onClose}>
          Cancel
        </TextButton>
        <TextButton
          variant="primary"
          type="submit"
          form="ai-edit-form"
          disabled={!userRequest.trim() || pickerLoading}
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

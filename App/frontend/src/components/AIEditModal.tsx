import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { BaseModal } from './BaseModal';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import type { ObjectType, ManuscriptObject, ChapterObject } from '../types/unifiedObject';
import type { FunctionCallMetadata } from '../llm/requestTypes';
import { LLMTask, LLMTaskMode, LLMTaskManager, type LLMTaskModeType, type EditAssistantStoryObjectPromptContext, type EditAssistantManuscriptPromptContext } from '../llm';
import { convertNativeOutputToFunctionCalls, processFunctionCallsForSession } from '../functionCall';
import { Expand, Collapse } from './icons';
import { ObjectPicker } from './ObjectPicker';
import { TextButton } from './TextButton';
import './AIEditModal.css';

type AIEditCategory = ObjectType | 'manuscript';

interface AIEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  category: AIEditCategory;
  projectId: string;
  targetId?: string;
  onResult?: (result?: any) => void | Promise<void>;
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
  onResult,
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

  const unifiedStore = useUnifiedObjectStore();
  const settingsStore = useSettingsStore();
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Get manuscript content for manuscript mode
  const getActiveLanguageContent = useCallback((chapterId: string): string => {
    const manuscriptObj = unifiedStore.getManuscriptByChapterId(chapterId) as ManuscriptObject | null;
    if (!manuscriptObj?.data) return '';
    const langData = manuscriptObj.data[mainLanguage] || Object.values(manuscriptObj.data)[0];
    return langData?.content || '';
  }, [unifiedStore, mainLanguage]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setUserRequest(defaultUserRequest ?? '');
      setSelectedContextIds(defaultSelectedContextIds ?? []);
      setPickerLoading(true);
      setError(null);
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

  // Build contextIds for LLM (filter out target)
  const buildContextIds = useCallback((): string[] => {
    if (isManuscriptMode && targetId) {
      const manuscriptObj = unifiedStore.getManuscriptByChapterId(targetId);
      return selectedContextIds.filter(id => id !== manuscriptObj?.id);
    }
    return selectedContextIds.filter(id => id !== targetId);
  }, [selectedContextIds, targetId, isManuscriptMode, unifiedStore]);

  // On picker load complete
  const handlePickerLoadComplete = useCallback(() => {
    setPickerLoading(false);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userRequest.trim()) return;

    setError(null);

    // Build title with item name if available
    const titleParts = [`AI ${categoryDisplayName} ${editTypeText} Edit`];
    if (itemName) {
      titleParts.push(`: ${itemName}`);
    }
    const toastLabel = titleParts.join('');

    // Start task via LLMTaskManager
    const task = LLMTaskManager.startTask({
      taskType: 'ai-edit',
      label: toastLabel,
      retryContext: {
        taskType: 'ai-edit',
        modalProps: { category, projectId, targetId, onResult },
        formState: { userRequest: userRequest.trim(), selectedContextIds },
      },
    });

    const editAssistantConfig = settingsStore.getFunctionConfig('editAssistant');
    const providerConfig = settingsStore.getProviderConfig(editAssistantConfig.provider);
    const isNativeOutput = settingsStore.settings.nativeOutputMode;

    const contextIds = buildContextIds();

    // Build prompt context based on mode
    let promptContext: EditAssistantStoryObjectPromptContext | EditAssistantManuscriptPromptContext;
    let llmMode: LLMTaskModeType;

    if (isManuscriptMode) {
      if (!targetId) {
        task.error('Manuscript edit requires a target chapter ID');
        return;
      }

      const manuscriptObj = unifiedStore.getManuscriptByChapterId(targetId);
      if (!manuscriptObj) {
        task.error(`Manuscript not found for chapter ${targetId}`);
        return;
      }

      const currentContent = getActiveLanguageContent(targetId);

      promptContext = {
        userInput: userRequest.trim(),
        projectId,
        currentId: manuscriptObj.id,
        currentChapterId: targetId,
        currentChapterName: itemName || '',
        currentChapterContent: currentContent,
        objectIds: contextIds.length > 0 ? contextIds : undefined,
        isNativeOutput,
        outputLanguage: mainLanguage,
        enablePrefill: editAssistantConfig.advanced.enablePrefill,
        enableThinking: editAssistantConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: editAssistantConfig.advanced.thinkingMode === 'custom',
      } as EditAssistantManuscriptPromptContext;

      llmMode = LLMTaskMode.EDIT_ASSISTANT_MANUSCRIPT;
    } else {
      const targetIds = targetId ? [targetId] : [];

      promptContext = {
        userInput: userRequest.trim(),
        projectId,
        targetIds,
        contextIds: contextIds.length > 0 ? contextIds : undefined,
        isNativeOutput,
        outputLanguage: mainLanguage,
        enablePrefill: editAssistantConfig.advanced.enablePrefill,
        enableThinking: editAssistantConfig.advanced.thinkingMode === 'model',
        enableCustomThinking: editAssistantConfig.advanced.thinkingMode === 'custom',
      } as EditAssistantStoryObjectPromptContext;

      llmMode = LLMTaskMode.EDIT_ASSISTANT_STORY_OBJECT;
    }

    // Fire-and-forget: Start LLM task with callbacks, close modal immediately
    const llmTask = new LLMTask(
      {
        mode: llmMode,
        projectId,
        promptContext,
        abortControllerRef,
        sessionId: task.sessionId,
        provider: editAssistantConfig.provider,
        providerConfig,
        model: editAssistantConfig.model,
        temperature: editAssistantConfig.temperature,
        thinkingMode: editAssistantConfig.advanced.thinkingMode as any,
        thinkingConfig: editAssistantConfig.advanced.thinkingConfig,
        retryConfig: settingsStore.settings.retryConfig,
      },
      {
        onUpdate: () => {},
        onComplete: async (result) => {
          try {
            let functionCalls: FunctionCallMetadata[];

            if (isNativeOutput) {
              const text = result.contentParts
                .filter(part => part.type === 'content')
                .map(part => part.text)
                .join('');

              functionCalls = convertNativeOutputToFunctionCalls(text);
            } else {
              functionCalls = result.functionCalls;
            }

            if (!functionCalls?.length) {
              task.error('AI response did not include structured edits to apply.');
              return;
            }

            // Process function calls and store in EditCardStore for confirmation
            await processFunctionCallsForSession(functionCalls, {
              projectId,
              language: mainLanguage,
              sessionId: task.sessionId,
            });
          } catch (err) {
            task.error(err instanceof Error ? err.message : 'An unknown error occurred.');
          }
        },
        onError: (err) => {
          if (err instanceof Error && err.name === 'AbortError') {
            task.cancel();
            return;
          }
          task.error(err instanceof Error ? err.message : 'An unknown error occurred.');
        },
      }
    );

    llmTask.run();

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

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { BaseModal } from './BaseModal';
import './TranslationModal.css';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { TranslationService } from '../services/translationService';
import type { StoryObjectToTranslate } from '../services/translationService';
import type { UnifiedObject, ObjectType } from '../types/unifiedObject';
import { LLMTaskManager } from '../llm';
import { Globe, Swap } from './icons';
import { ObjectPicker, CATEGORY_CONFIG as PICKER_CATEGORY_CONFIG } from './ObjectPicker';
import CollapsibleSection from './ui/CollapsibleSection';
import { TextButton } from './TextButton';
import { IconButton } from './IconButton';

interface TranslationModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onComplete: () => void;
  allowedObjectTypes?: string[];  // If provided, only show these types and hide type selector
  defaultSourceLanguage?: string;
  defaultTargetLanguage?: string;
  defaultUserInput?: string;
  preSelectedObjectIds?: string[];  // If provided, skip tree selector and show only these objects
}

// Category display names and order (use from ObjectPicker)
const CATEGORY_CONFIG = PICKER_CATEGORY_CONFIG;

const TranslationModal: React.FC<TranslationModalProps> = ({
  isOpen,
  onClose,
  projectId,
  onComplete,
  allowedObjectTypes,
  defaultSourceLanguage,
  defaultTargetLanguage,
  defaultUserInput,
  preSelectedObjectIds,
}) => {
  const [sourceLanguage, setSourceLanguage] = useState<string>(defaultSourceLanguage || '');
  const [targetLanguage, setTargetLanguage] = useState<string>(defaultTargetLanguage || '');
  const [userInput, setUserInput] = useState(defaultUserInput || '');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isObjectsCollapsed, setIsObjectsCollapsed] = useState(false);

  // Context selection for target language reference
  const [selectedContextIds, setSelectedContextIds] = useState<Set<string>>(new Set());
  const [isContextCollapsed, setIsContextCollapsed] = useState(true);

  const abortControllerRef = useRef<AbortController | null>(null);
  const hasInitializedSelectionRef = useRef(false);
  const store = useUnifiedObjectStore();
  const settings = useSettingsStore((state) => state.settings);

  // Build available languages list
  const availableLanguages = useMemo(() => {
    const languages = [settings.mainLanguage];
    if (settings.subLanguages && settings.subLanguages.length > 0) {
      languages.push(...settings.subLanguages);
    }
    return languages;
  }, [settings.mainLanguage, settings.subLanguages]);

  // Get IDs of objects that have target language translations (for context reference)
  const contextObjectIds = useMemo((): string[] => {
    if (!targetLanguage) return [];

    const ids: string[] = [];
    const allObjects = Object.values(store.objects) as UnifiedObject<any>[];

    allObjects.forEach(obj => {
      if (obj.metadata?.project_id !== projectId) return;
      if (!obj.data[targetLanguage]) return; // Must have target language translation

      const objType = obj.type;
      // Skip manuscript and basic_info for context
      if (objType === 'manuscript' || objType === 'basic_info') return;

      ids.push(obj.id);
    });

    return ids;
  }, [store.objects, projectId, targetLanguage]);

  const hasAnyContext = contextObjectIds.length > 0;

  // Generate context data from selected context objects
  const generateTargetLanguageContext = (): Record<string, any> => {
    if (selectedContextIds.size === 0) return {};

    const context: Record<string, any> = {};
    const byType: Record<string, any[]> = {};

    selectedContextIds.forEach(id => {
      const obj = store.objects[id];
      if (!obj || !obj.data[targetLanguage]) return;

      const data = obj.data[targetLanguage];
      const type = obj.type;

      if (!byType[type]) {
        byType[type] = [];
      }

      byType[type].push({
        id: obj.id,
        name: data.name || '',
        description: data.description || '',
      });
    });

    // Map to context structure expected by prompt template
    if (byType.character) context.characters = byType.character;
    if (byType.organization) context.organizations = byType.organization;
    if (byType.location) context.locations = byType.location;
    if (byType.lorebook) context.lorebook = byType.lorebook;
    if (byType.act || byType.chapter) {
      // Build outline structure
      const acts = (byType.act || []).map((act: any) => ({
        ...act,
        chapters: (byType.chapter || []).filter((ch: any) => {
          const chObj = store.objects[ch.id];
          return chObj?.metadata?.act_id === act.id;
        }),
      }));
      if (acts.length > 0) {
        context.outline = { acts };
      }
    }

    return context;
  };

  // Initialize languages from settings - detect which direction has objects to translate
  useEffect(() => {
    if (isOpen && !sourceLanguage && settings.subLanguages && settings.subLanguages.length > 0) {
      const allObjects = Object.values(store.objects) as UnifiedObject<any>[];

      // Find the sub language that has the most objects needing translation
      let bestTargetLanguage = settings.subLanguages[0];
      let maxObjectsToTranslate = 0;

      settings.subLanguages.forEach((subLang: string) => {
        let count = 0;
        allObjects.forEach(obj => {
          if (obj.metadata?.project_id !== projectId) return;
          if (!Object.keys(obj.data || {}).includes(subLang)) {
            count++;
          }
        });
        if (count > maxObjectsToTranslate) {
          maxObjectsToTranslate = count;
          bestTargetLanguage = subLang;
        }
      });

      // Default: mainLanguage -> best sub language
      setSourceLanguage(settings.mainLanguage);
      setTargetLanguage(bestTargetLanguage);
    }
  }, [isOpen, settings.mainLanguage, settings.subLanguages, sourceLanguage, store.objects, projectId]);

  // Get all available objects that need translation (before selection filter)
  const availableObjects = useMemo(() => {
    if (!targetLanguage || !sourceLanguage) return [];

    const objects: (StoryObjectToTranslate & { label: string; order?: number })[] = [];
    const allObjects = Object.values(store.objects) as UnifiedObject<any>[];

    // When preSelectedObjectIds is provided, use those objects regardless of translation status
    const preSelectedSet = preSelectedObjectIds ? new Set(preSelectedObjectIds) : null;

    allObjects.forEach(obj => {
      if (obj.metadata?.project_id !== projectId) return;

      // If preSelectedObjectIds is provided, only include those specific objects
      if (preSelectedSet) {
        if (!preSelectedSet.has(obj.id)) return;
        // For pre-selected objects, skip target language check (allow retranslation)
      } else {
        // Normal mode: skip if already translated
        if (Object.keys(obj.data || {}).includes(targetLanguage)) return;
      }

      if (!Object.keys(obj.data || {}).includes(sourceLanguage)) return; // Skip if no source language data

      const objType = obj.type;

      // If allowedObjectTypes is specified, only include those types
      if (allowedObjectTypes && !allowedObjectTypes.includes(objType)) return;

      const sourceData = obj.data[sourceLanguage] || obj.data[Object.keys(obj.data)[0]] || {};
      let label = sourceData.name || sourceData.title || obj.id;

      // For manuscripts, show chapter name instead of manuscript ID and derive order from chapter/act
      let order = obj.metadata.order;
      if (objType === 'manuscript' && obj.metadata?.chapter_id) {
        const chapter = store.objects[obj.metadata.chapter_id as string];
        if (chapter) {
          const chapterData = chapter.data[sourceLanguage] || chapter.data[Object.keys(chapter.data)[0]];
          if (chapterData?.name) {
            label = chapterData.name;
          }
          // Derive order from parent chapter and act for proper hierarchical sorting
          const chapterOrder = chapter.metadata?.order ?? 0;
          const act = chapter.metadata?.act_id ? store.objects[chapter.metadata.act_id as string] : null;
          const actOrder = act?.metadata?.order ?? 0;
          order = actOrder * 1000 + chapterOrder;
        }
      }

      objects.push({
        objectType: objType as ObjectType,
        objectId: obj.id,
        sourceData,
        versionNumber: obj.version?.number,
        label,
        order,
      });
    });

    // Sort by order for acts and chapters (objects without order will be at the end)
    return objects.sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
  }, [store.objects, projectId, targetLanguage, sourceLanguage, allowedObjectTypes, preSelectedObjectIds]);

  // Get IDs of objects that need translation
  const availableObjectIds = useMemo(() => {
    return availableObjects.map(obj => obj.objectId);
  }, [availableObjects]);

  // Initialize selectedIds when modal opens (select all by default, or use preSelectedObjectIds)
  useEffect(() => {
    if (!isOpen) return; // Don't initialize when closed

    if (preSelectedObjectIds && preSelectedObjectIds.length > 0) {
      // When preSelectedObjectIds is provided, use those directly
      setSelectedIds(new Set(preSelectedObjectIds));
      hasInitializedSelectionRef.current = true;
    } else if (availableObjectIds.length > 0 && !hasInitializedSelectionRef.current) {
      // Only auto-select all on initial load, not when user manually deselects
      setSelectedIds(new Set(availableObjectIds));
      hasInitializedSelectionRef.current = true;
    }
  }, [isOpen, availableObjectIds, preSelectedObjectIds]);

  // Sync selectedIds with availableObjects - remove stale selections
  useEffect(() => {
    const availableIds = new Set(availableObjects.map(obj => obj.objectId));
    setSelectedIds(prev => {
      const filtered = new Set([...prev].filter(id => availableIds.has(id)));
      if (filtered.size !== prev.size) {
        return filtered;
      }
      return prev;
    });
  }, [availableObjects]);

  // Get objects to translate based on selection
  const objectsToTranslate = useMemo((): StoryObjectToTranslate[] => {
    return availableObjects.filter(obj => selectedIds.has(obj.objectId));
  }, [availableObjects, selectedIds]);

  // Reset state when modal closes
  // Note: abort is handled by LLMTaskManager.cancelTask() via toast dismiss, not here
  useEffect(() => {
    if (!isOpen) {
      setUserInput('');
      setSelectedIds(new Set());
      hasInitializedSelectionRef.current = false;
      abortControllerRef.current = null;
    }
  }, [isOpen]);

  const handleStart = async () => {
    if (objectsToTranslate.length === 0) {
      return;
    }

    // Generate context data from selected context objects
    const contextData = selectedContextIds.size > 0 ? generateTargetLanguageContext() : undefined;

    // Start task via LLMTaskManager - returns a handle with bound completion functions
    const task = LLMTaskManager.startTask({
      taskType: 'translation',
      label: 'Translation',
      retryContext: {
        taskType: 'translation',
        modalProps: {
          projectId,
          onComplete,
          allowedObjectTypes,
        },
        formState: {
          sourceLanguage,
          targetLanguage,
          userInput,
        },
      },
    });

    // Auto-close modal - request continues in background, toast shows progress
    onClose();

    try {
      await TranslationService.translateBatch(objectsToTranslate, {
        projectId,
        sourceLanguage,
        targetLanguage,
        userInput: userInput.trim() || undefined,
        contextData,
        sessionId: task.sessionId,
        onProgress: (completed) => {
          task.updateProgress(completed.length, objectsToTranslate.length);
        },
        onError: (err) => {
          task.error(err.message);
        },
        onPartialSuccess: (translations, err) => {
          // Partial success - apply what we got
          task.error(err.message);
          TranslationService.applyPartialTranslations(translations, targetLanguage)
            .then(() => onComplete())
            .catch(console.error);
        },
        abortControllerRef,
      });

      // Success
      task.complete();
      onComplete();
    } catch {
      // Error already handled by onError callback
    }
  };

  const handleSwapLanguages = () => {
    const temp = sourceLanguage;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(temp);
  };

  // Handle ObjectPicker selection changes
  const handleSelectionChange = (ids: string[] | string) => {
    if (Array.isArray(ids)) {
      setSelectedIds(new Set(ids));
    } else {
      setSelectedIds(new Set([ids]));
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="medium"
      title={<><Globe size="xl" /> Translation</>}
      className="translation-modal"
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose}>
            Cancel
          </TextButton>
          <TextButton
            variant="primary"
            onClick={handleStart}
            disabled={objectsToTranslate.length === 0 || !targetLanguage}
          >
            Start Translation
          </TextButton>
        </>
      }
    >
      <div className="translation-config">
        <div className="form-group">
          <label>Languages</label>
          <div className="language-selector-row">
            <select
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value)}
              className="language-select"
            >
              {availableLanguages.map(lang => (
                <option key={lang} value={lang}>{lang}</option>
              ))}
            </select>
            <IconButton
              icon={<Swap size="md" />}
              onClick={handleSwapLanguages}
              title="Swap languages"
              size="sm"
            />
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="language-select"
            >
              {availableLanguages
                .filter(lang => lang !== sourceLanguage)
                .map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
            </select>
          </div>
        </div>

        {/* Pre-selected object display (when preSelectedObjectIds is provided) */}
        {preSelectedObjectIds && preSelectedObjectIds.length > 0 && availableObjects.length > 0 && (
          <div className="form-group">
            <label>Object to Translate</label>
            <div className="preselected-objects">
              {availableObjects.map(obj => (
                <div key={obj.objectId} className="preselected-object-item">
                  <span className="object-type-badge">{CATEGORY_CONFIG[obj.objectType]?.label || obj.objectType}</span>
                  <span className="object-name">{obj.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tree-based object selector (when no preSelectedObjectIds) */}
        {!preSelectedObjectIds && availableObjectIds.length > 0 && (
          <CollapsibleSection
            label="Objects to Translate"
            expanded={!isObjectsCollapsed}
            onExpandChange={(expanded) => setIsObjectsCollapsed(!expanded)}
            selectedCount={selectedIds.size}
            totalCount={availableObjects.length}
            onToggleAll={(selectAll) => {
              if (selectAll) {
                setSelectedIds(new Set(availableObjectIds));
              } else {
                setSelectedIds(new Set());
              }
            }}
          >
            <ObjectPicker
              mode="all"
              selectionMode="multi"
              selectedIds={Array.from(selectedIds)}
              onChange={handleSelectionChange}
              projectId={projectId}
              language={sourceLanguage}
              filterIds={availableObjectIds}
              showSearch={false}
              maxHeight="300px"
              emptyMessage="No objects available for translation"
            />
          </CollapsibleSection>
        )}

        <div className="form-group">
          <label htmlFor="instructions">Additional Instructions (Optional)</label>
          <textarea
            id="instructions"
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="e.g., Maintain formal tone, Use specific terminology..."
            rows={3}
          />
        </div>

        {/* Context Section - select already-translated objects as reference */}
        {hasAnyContext && (
          <CollapsibleSection
            label="Context (Target Language)"
            expanded={!isContextCollapsed}
            onExpandChange={(expanded) => setIsContextCollapsed(!expanded)}
            selectedCount={selectedContextIds.size}
            totalCount={contextObjectIds.length}
            onToggleAll={(selectAll) => {
              if (selectAll) {
                setSelectedContextIds(new Set(contextObjectIds));
              } else {
                setSelectedContextIds(new Set());
              }
            }}
          >
            <ObjectPicker
              mode="story-objects"
              selectionMode="multi"
              selectedIds={Array.from(selectedContextIds)}
              onChange={(ids) => {
                if (Array.isArray(ids)) {
                  setSelectedContextIds(new Set(ids));
                }
              }}
              projectId={projectId}
              language={targetLanguage}
              filterIds={contextObjectIds}
              showSearch={false}
              maxHeight="200px"
              emptyMessage="No translated objects available"
            />
          </CollapsibleSection>
        )}

        {/* Summary - only show for batch mode */}
        {!preSelectedObjectIds && (
          <div className="translation-summary">
            <strong>{objectsToTranslate.length}</strong> of <strong>{availableObjects.length}</strong> objects selected
          </div>
        )}
      </div>
    </BaseModal>
  );
};

export default TranslationModal;

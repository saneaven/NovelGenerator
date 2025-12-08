import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import './TranslationModal.css';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useLLMTaskStore } from '../store/llmTaskStore';
import { TranslationService } from '../services/translationService';
import type { StoryObjectToTranslate, TranslationResult } from '../services/translationService';
import type { ParsedItem } from '../utils/nativeOutputParser';
import type { UnifiedObject, ObjectType } from '../types/unifiedObject';
import ThinkingDisplay from './ThinkingDisplay';
import { useLLMToast } from '../hooks/useLLMToast';

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

type ScreenType = 'config' | 'progress' | 'complete';

// Tree node for object selection
interface TranslationTreeNode {
  id: string;
  label: string;
  type: 'category' | 'object';
  objectType: ObjectType;
  children?: TranslationTreeNode[];
  sourceData?: Record<string, any>;
}

// Category display names and order
const CATEGORY_CONFIG: Record<string, { label: string; order: number }> = {
  basic_info: { label: 'Basic Info', order: 0 },
  character: { label: 'Characters', order: 1 },
  organization: { label: 'Organizations', order: 2 },
  location: { label: 'Locations', order: 3 },
  lorebook: { label: 'Lorebook', order: 4 },
  act: { label: 'Acts', order: 5 },
  chapter: { label: 'Chapters', order: 6 },
  manuscript: { label: 'Manuscript', order: 7 },
};

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
  const [screen, setScreen] = useState<ScreenType>('config');
  const [sourceLanguage, setSourceLanguage] = useState<string>(defaultSourceLanguage || '');
  const [targetLanguage, setTargetLanguage] = useState<string>(defaultTargetLanguage || '');
  const [userInput, setUserInput] = useState(defaultUserInput || '');
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [partialTranslations, setPartialTranslations] = useState<TranslationResult[]>([]);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [_streamItems, setStreamItems] = useState<ParsedItem[]>([]);

  // Currently streaming translation item (partial JSON parsed)
  const [currentStreamingItem, setCurrentStreamingItem] = useState<{
    objectType: string;
    objectId: string;
    sourceName: string;
    partialData: Record<string, any>;
  } | null>(null);

  // Tree selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const abortControllerRef = useRef<AbortController | null>(null);
  const toastSessionIdRef = useRef<string>(`translation-${Date.now()}`);
  const store = useUnifiedObjectStore();
  const settings = useSettingsStore((state) => state.settings);

  // Generate new session ID when modal opens
  useEffect(() => {
    if (isOpen) {
      toastSessionIdRef.current = `translation-${Date.now()}`;
    }
  }, [isOpen]);

  // Toast notification for LLM requests
  const { startTask, updateProgress, completeSuccess, completeError } = useLLMToast({
    sessionId: toastSessionIdRef.current,
    taskType: 'translation',
    label: 'Translation',
  });

  // Get streaming content from store
  const getSessionById = useLLMTaskStore((state) => state.getSessionById);
  const setContentParts = useLLMTaskStore((state) => state.setContentParts);
  const session = getSessionById(toastSessionIdRef.current);
  const contentParts = session?.contentParts || [];

  // Build available languages list
  const availableLanguages = useMemo(() => {
    const languages = [settings.mainLanguage];
    if (settings.subLanguages && settings.subLanguages.length > 0) {
      languages.push(...settings.subLanguages);
    }
    return languages;
  }, [settings.mainLanguage, settings.subLanguages]);

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
      const label = sourceData.name || sourceData.title || obj.id;

      objects.push({
        objectType: objType as ObjectType,
        objectId: obj.id,
        sourceData,
        versionNumber: obj.version?.number,
        label,
        order: obj.metadata.order,
      });
    });

    // Sort by order for acts and chapters (objects without order will be at the end)
    return objects.sort((a, b) => {
      const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });
  }, [store.objects, projectId, targetLanguage, sourceLanguage, allowedObjectTypes, preSelectedObjectIds]);

  // Build tree structure from available objects
  const translationTree = useMemo((): TranslationTreeNode[] => {
    const grouped: Record<string, (StoryObjectToTranslate & { label: string; order?: number })[]> = {};

    availableObjects.forEach(obj => {
      if (!grouped[obj.objectType]) {
        grouped[obj.objectType] = [];
      }
      grouped[obj.objectType].push(obj);
    });

    const tree: TranslationTreeNode[] = [];

    Object.entries(grouped)
      .sort((a, b) => {
        const orderA = CATEGORY_CONFIG[a[0]]?.order ?? 999;
        const orderB = CATEGORY_CONFIG[b[0]]?.order ?? 999;
        return orderA - orderB;
      })
      .forEach(([type, objects]) => {
        const config = CATEGORY_CONFIG[type] || { label: type, order: 999 };
        const categoryNode: TranslationTreeNode = {
          id: `category:${type}`,
          label: `${config.label} (${objects.length})`,
          type: 'category',
          objectType: type as ObjectType,
          children: objects
            .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
            .map(obj => ({
              id: obj.objectId,
              label: obj.label,
              type: 'object' as const,
              objectType: obj.objectType,
              sourceData: obj.sourceData,
            })),
        };
        tree.push(categoryNode);
      });

    return tree;
  }, [availableObjects]);

  // Initialize selectedIds when tree changes (select all by default, or use preSelectedObjectIds)
  useEffect(() => {
    if (preSelectedObjectIds && preSelectedObjectIds.length > 0) {
      // When preSelectedObjectIds is provided, use those directly
      setSelectedIds(new Set(preSelectedObjectIds));
    } else if (translationTree.length > 0 && selectedIds.size === 0) {
      const allIds = new Set<string>();
      translationTree.forEach(category => {
        category.children?.forEach(child => {
          allIds.add(child.id);
        });
      });
      setSelectedIds(allIds);
    }
  }, [translationTree, selectedIds.size, preSelectedObjectIds]);

  // Get objects to translate based on selection
  const objectsToTranslate = useMemo((): StoryObjectToTranslate[] => {
    return availableObjects.filter(obj => selectedIds.has(obj.objectId));
  }, [availableObjects, selectedIds]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setScreen('config');
      setCompletedIds([]);
      setError(null);
      setPartialTranslations([]);
      setPartialError(null);
      setIsApplying(false);
      setStreamItems([]);
      setContentParts(toastSessionIdRef.current, []);
      setCurrentStreamingItem(null);
      setUserInput('');
      setSelectedIds(new Set());
      setExpandedCategories(new Set());
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
  }, [isOpen]);

  const handleStart = async () => {
    if (objectsToTranslate.length === 0) {
      setError('No objects to translate');
      return;
    }

    setTotalCount(objectsToTranslate.length);
    setError(null);
    setPartialError(null);
    setPartialTranslations([]);
    setStreamItems([]);
    setContentParts(toastSessionIdRef.current, []);
    setCurrentStreamingItem(null);

    // Start toast notification with retry context
    startTask({
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
    });

    // Auto-close modal - request continues in background, toast shows progress
    onClose();

    try {
      await TranslationService.translateBatch(objectsToTranslate, {
        projectId,
        sourceLanguage,
        targetLanguage,
        userInput: userInput.trim() || undefined,
        sessionId: toastSessionIdRef.current,
        onProgress: (completed) => {
          setCompletedIds(completed);
          // Update toast progress
          updateProgress(completed.length, objectsToTranslate.length);
          // Clear current streaming item when it's completed
          setCurrentStreamingItem(prev => {
            if (prev && completed.includes(prev.objectId)) {
              return null;
            }
            return prev;
          });
        },
        onError: (err) => {
          setError(err.message);
          completeError(err.message);
          // Modal already closed - error shown in toast
        },
        onPartialSuccess: (translations, err) => {
          // Partial success - toast will show error, apply what we got
          setPartialTranslations(translations);
          setPartialError(err.message);
          // Try to apply partial translations automatically
          TranslationService.applyPartialTranslations(translations, targetLanguage)
            .then(() => onComplete())
            .catch(console.error);
        },
        onStreamParsed: (items) => {
          setStreamItems(items);
          // Update current streaming item from parsed items
          if (items.length > 0) {
            const lastItem = items[items.length - 1];
            if (lastItem.id) {
              const matchingObj = objectsToTranslate.find(o => o.objectId === lastItem.id);
              if (matchingObj) {
                setCurrentStreamingItem({
                  objectType: matchingObj.objectType,
                  objectId: lastItem.id,
                  sourceName: matchingObj.sourceData.name || matchingObj.sourceData.title || matchingObj.objectId,
                  partialData: lastItem
                });
              }
            }
          }
        },
        onStreamUpdate: () => {}, // Store is now updated by LLMRequestManager internally
        onFunctionCallProgress: (progressList) => {
          // Update current streaming item from function call progress
          if (progressList.length > 0) {
            const last = progressList[progressList.length - 1];
            const args = last.draft.parsedArguments;
            if (args?.id) {
              const matchingObj = objectsToTranslate.find(o => o.objectId === args.id);
              if (matchingObj) {
                setCurrentStreamingItem({
                  objectType: matchingObj.objectType,
                  objectId: args.id,
                  sourceName: matchingObj.sourceData.name || matchingObj.sourceData.title || matchingObj.objectId,
                  partialData: args
                });
              }
            }
          }
        },
        abortControllerRef,
      });

      // Success
      completeSuccess();
      onComplete();
      // Modal already closed - success shown in toast
    } catch (err) {
      // Error already handled by onError callback - no need to call completeError again
      if (partialTranslations.length === 0) {
        const errorMsg = err instanceof Error ? err.message : 'Translation failed';
        setError(errorMsg);
      }
    }
  };

  // Just close modal - don't abort (request continues in background)
  const handleClose = () => {
    onClose();
  };

  const handleSwapLanguages = () => {
    const temp = sourceLanguage;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(temp);
  };

  // Tree selection handlers
  const toggleCategory = useCallback((categoryNode: TranslationTreeNode) => {
    const childIds = categoryNode.children?.map(c => c.id) || [];
    const allSelected = childIds.every(id => selectedIds.has(id));

    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all children
        childIds.forEach(id => next.delete(id));
      } else {
        // Select all children
        childIds.forEach(id => next.add(id));
      }
      return next;
    });
  }, [selectedIds]);

  const toggleObject = useCallback((objectId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(objectId)) {
        next.delete(objectId);
      } else {
        next.add(objectId);
      }
      return next;
    });
  }, []);

  const toggleExpand = useCallback((categoryId: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const allIds = new Set<string>();
    translationTree.forEach(category => {
      category.children?.forEach(child => {
        allIds.add(child.id);
      });
    });
    setSelectedIds(allIds);
  }, [translationTree]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Get category checkbox state (checked, unchecked, or indeterminate)
  const getCategoryState = useCallback((category: TranslationTreeNode): 'checked' | 'unchecked' | 'indeterminate' => {
    const childIds = category.children?.map(c => c.id) || [];
    if (childIds.length === 0) return 'unchecked';

    const selectedCount = childIds.filter(id => selectedIds.has(id)).length;
    if (selectedCount === 0) return 'unchecked';
    if (selectedCount === childIds.length) return 'checked';
    return 'indeterminate';
  }, [selectedIds]);

  const handleApplyPartial = async () => {
    if (partialTranslations.length === 0) return;

    setIsApplying(true);
    try {
      await TranslationService.applyPartialTranslations(partialTranslations, targetLanguage);
      // Move to complete screen with partial success message
      setPartialError(null);
      setScreen('complete');
      onComplete();
    } catch (err) {
      setPartialError(err instanceof Error ? err.message : 'Failed to apply translations');
    } finally {
      setIsApplying(false);
    }
  };

  const handleDiscardPartial = () => {
    setPartialTranslations([]);
    setPartialError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content translation-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🌐 Translation</h2>
          <button className="modal-close" onClick={handleClose}>×</button>
        </div>

        {/* Configuration Screen */}
        {screen === 'config' && (
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
                <button
                  onClick={handleSwapLanguages}
                  className="swap-languages-btn"
                  title="Swap languages"
                >
                  ⇄
                </button>
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
            {!preSelectedObjectIds && translationTree.length > 0 && (
              <div className="form-group">
                <div className="tree-header">
                  <label>Select Objects to Translate</label>
                  <div className="tree-actions">
                    <button type="button" className="tree-action-btn" onClick={selectAll}>
                      Select All
                    </button>
                    <button type="button" className="tree-action-btn" onClick={deselectAll}>
                      Deselect All
                    </button>
                  </div>
                </div>
                <div className="translation-tree">
                  {translationTree.map(category => {
                    const categoryState = getCategoryState(category);
                    const isExpanded = expandedCategories.has(category.id);

                    return (
                      <div key={category.id} className="tree-category">
                        <div className="tree-category-header">
                          <button
                            type="button"
                            className="tree-expand-btn"
                            onClick={() => toggleExpand(category.id)}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                          <label className="tree-category-checkbox">
                            <input
                              type="checkbox"
                              checked={categoryState === 'checked'}
                              ref={(el) => {
                                if (el) el.indeterminate = categoryState === 'indeterminate';
                              }}
                              onChange={() => toggleCategory(category)}
                            />
                            <span>{category.label}</span>
                          </label>
                        </div>
                        {isExpanded && category.children && (
                          <div className="tree-children">
                            {category.children.map(child => (
                              <label key={child.id} className="tree-object-checkbox">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(child.id)}
                                  onChange={() => toggleObject(child.id)}
                                />
                                <span>{child.label}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
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

            {/* Summary - only show for batch mode */}
            {!preSelectedObjectIds && (
              <div className="translation-summary">
                <strong>{selectedIds.size}</strong> of <strong>{availableObjects.length}</strong> objects selected
              </div>
            )}

            <div className="modal-actions">
              <button onClick={handleClose} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={handleStart}
                className="btn-primary"
                disabled={objectsToTranslate.length === 0 || !targetLanguage}
              >
                Start Translation
              </button>
            </div>
          </div>
        )}

        {/* Progress Screen */}
        {screen === 'progress' && (
          <div className="translation-progress">
            {/* Inline Error Banner for Partial Success */}
            {partialError && (
              <div className="partial-error-banner">
                <div className="partial-error-header">
                  <span className="partial-error-icon">⚠️</span>
                  <span className="partial-error-title">Translation Interrupted</span>
                </div>
                <p className="partial-error-message">{partialError}</p>
                <p className="partial-error-summary">
                  {partialTranslations.length} of {totalCount} translations were received successfully.
                </p>
              </div>
            )}

            {/* Progress Header with Bar */}
            <div className="progress-header">
              <p>
                {partialError
                  ? `Received ${partialTranslations.length} of ${totalCount} translations`
                  : `Progress: ${completedIds.length} / ${totalCount} completed`
                }
              </p>
              <div className="progress-bar">
                <div
                  className={`progress-fill ${partialError ? 'partial' : ''}`}
                  style={{ width: `${(completedIds.length / totalCount) * 100}%` }}
                />
              </div>
            </div>

            {/* Thinking Display */}
            {contentParts.some(p => p.type === 'thinking') && (
              <ThinkingDisplay
                messageId="translation"
                contentParts={contentParts}
                displayMode="separate"
                isStreaming={true}
              />
            )}

            {/* Currently Translating Card - Shows actual streaming content */}
            {currentStreamingItem && !partialError && (
              <div className="current-translation-card">
                <div className="current-translation-header">
                  <span className="streaming-dot"></span>
                  Currently Translating: {currentStreamingItem.objectType}
                </div>
                <div className="current-translation-source">
                  {currentStreamingItem.sourceName}
                </div>
                <div className="current-translation-content">
                  {currentStreamingItem.partialData.name && (
                    <div className="translation-field">
                      <span className="field-label">name:</span>
                      <span className="field-value">{currentStreamingItem.partialData.name}</span>
                    </div>
                  )}
                  {currentStreamingItem.partialData.description && (
                    <div className="translation-field">
                      <span className="field-label">description:</span>
                      <span className="field-value streaming-text">
                        {currentStreamingItem.partialData.description}
                        <span className="cursor">█</span>
                      </span>
                    </div>
                  )}
                  {currentStreamingItem.partialData.content && (
                    <div className="translation-field">
                      <span className="field-label">content:</span>
                      <span className="field-value streaming-text">
                        {currentStreamingItem.partialData.content.length > 500
                          ? `${currentStreamingItem.partialData.content.slice(0, 500)}...`
                          : currentStreamingItem.partialData.content}
                        <span className="cursor">█</span>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Completed Section */}
            {completedIds.length > 0 && (
              <div className="completed-section">
                <div className="section-header">Completed ({completedIds.length})</div>
                <div className="completed-list">
                  {objectsToTranslate
                    .filter(obj => completedIds.includes(obj.objectId))
                    .map(obj => (
                      <div key={obj.objectId} className="completed-item">
                        ✓ {obj.objectType}: {obj.sourceData.name || obj.sourceData.title || obj.objectId}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Pending Section */}
            {(() => {
              const pendingObjects = objectsToTranslate.filter(
                obj => !completedIds.includes(obj.objectId) && obj.objectId !== currentStreamingItem?.objectId
              );
              const pendingCount = pendingObjects.length;
              if (pendingCount === 0) return null;
              return (
                <div className="pending-section">
                  <div className="section-header">Pending ({pendingCount})</div>
                  <div className="pending-list compact">
                    {pendingObjects.slice(0, 5).map(obj => (
                      <span key={obj.objectId} className="pending-item">
                        ○ {obj.sourceData.name || obj.sourceData.title || obj.objectId}
                      </span>
                    ))}
                    {pendingCount > 5 && <span className="more-indicator">+{pendingCount - 5} more</span>}
                  </div>
                </div>
              );
            })()}

            <div className="modal-actions">
              {partialError ? (
                <>
                  <button onClick={handleDiscardPartial} className="btn-secondary">
                    Discard All
                  </button>
                  <button
                    onClick={handleApplyPartial}
                    className="btn-primary"
                    disabled={isApplying || partialTranslations.length === 0}
                  >
                    {isApplying ? 'Applying...' : `Apply ${partialTranslations.length} Successful`}
                  </button>
                </>
              ) : (
                <button onClick={handleClose} className="btn-secondary">
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Complete Screen */}
        {screen === 'complete' && (
          <div className="translation-complete">
            {error ? (
              <>
                <div className="error-message">
                  <h3>❌ Translation Failed</h3>
                  <p>{error}</p>
                </div>
                <div className="modal-actions">
                  <button onClick={onClose} className="btn-primary">
                    Close
                  </button>
                </div>
              </>
            ) : partialTranslations.length > 0 && partialTranslations.length < totalCount ? (
              <>
                <div className="partial-success-message">
                  <h3>⚠️ Partial Translation Applied</h3>
                  <p>Applied {partialTranslations.length} translations successfully.</p>
                  <p className="partial-warning">{totalCount - partialTranslations.length} items were not translated.</p>
                </div>
                <div className="modal-actions">
                  <button onClick={onClose} className="btn-primary">
                    Close
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="success-message">
                  <h3>✓ Translation Complete</h3>
                  <p>Successfully translated {completedIds.length} objects!</p>
                </div>
                <div className="modal-actions">
                  <button onClick={onClose} className="btn-primary">
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default TranslationModal;

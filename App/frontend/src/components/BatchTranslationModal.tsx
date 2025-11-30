import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import './BatchTranslationModal.css';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { TranslationService } from '../services/translationService';
import type { StoryObjectToTranslate, TranslationResult } from '../services/translationService';
import type { UnifiedObject, ObjectType } from '../types/unifiedObject';

interface BatchTranslationModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onComplete: () => void;
  allowedObjectTypes?: string[];  // If provided, only show these types and hide type selector
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

const BatchTranslationModal: React.FC<BatchTranslationModalProps> = ({
  isOpen,
  onClose,
  projectId,
  onComplete,
  allowedObjectTypes,
}) => {
  const [screen, setScreen] = useState<ScreenType>('config');
  const [sourceLanguage, setSourceLanguage] = useState<string>('');
  const [targetLanguage, setTargetLanguage] = useState<string>('');
  const [userInstructions, setUserInstructions] = useState('');
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [partialTranslations, setPartialTranslations] = useState<TranslationResult[]>([]);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [isApplying, setIsApplying] = useState(false);

  // Tree selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const abortControllerRef = useRef<AbortController | null>(null);
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

    const objects: (StoryObjectToTranslate & { label: string })[] = [];
    const allObjects = Object.values(store.objects) as UnifiedObject<any>[];

    allObjects.forEach(obj => {
      if (obj.metadata?.project_id !== projectId) return;
      if (Object.keys(obj.data || {}).includes(targetLanguage)) return; // Skip if already translated
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
        label,
      });
    });

    return objects;
  }, [store.objects, projectId, targetLanguage, sourceLanguage, allowedObjectTypes]);

  // Build tree structure from available objects
  const translationTree = useMemo((): TranslationTreeNode[] => {
    const grouped: Record<string, (StoryObjectToTranslate & { label: string })[]> = {};

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
          children: objects.map(obj => ({
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

  // Initialize selectedIds when tree changes (select all by default)
  useEffect(() => {
    if (translationTree.length > 0 && selectedIds.size === 0) {
      const allIds = new Set<string>();
      translationTree.forEach(category => {
        category.children?.forEach(child => {
          allIds.add(child.id);
        });
      });
      setSelectedIds(allIds);
    }
  }, [translationTree, selectedIds.size]);

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
      setUserInstructions('');
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

    setScreen('progress');
    setTotalCount(objectsToTranslate.length);
    setError(null);
    setPartialError(null);
    setPartialTranslations([]);

    try {
      await TranslationService.translateBatch(objectsToTranslate, {
        projectId,
        sourceLanguage,
        targetLanguage,
        userInstructions: userInstructions.trim() || undefined,
        onProgress: (completed) => {
          setCompletedIds(completed);
        },
        onError: (err) => {
          setError(err.message);
          setScreen('complete');
        },
        onPartialSuccess: (translations, err) => {
          // Stay on progress screen with partial results
          setPartialTranslations(translations);
          setPartialError(err.message);
        },
        abortControllerRef,
      });

      // Success
      setScreen('complete');
      onComplete();
    } catch (err) {
      // If we have partial translations, don't go to complete screen
      // (the onPartialSuccess callback already handled it)
      if (partialTranslations.length === 0) {
        setError(err instanceof Error ? err.message : 'Translation failed');
        setScreen('complete');
      }
    }
  };

  const handleCancel = () => {
    if (screen === 'progress') {
      abortControllerRef.current?.abort();
    }
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
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content batch-translation-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🌐 Batch Translation</h2>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        {/* Configuration Screen */}
        {screen === 'config' && (
          <div className="batch-translation-config">
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

            {/* Tree-based object selector */}
            {!allowedObjectTypes && translationTree.length > 0 && (
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
                value={userInstructions}
                onChange={(e) => setUserInstructions(e.target.value)}
                placeholder="e.g., Maintain formal tone, Use specific terminology..."
                rows={3}
              />
            </div>

            <div className="translation-summary">
              <strong>{selectedIds.size}</strong> of <strong>{availableObjects.length}</strong> objects selected
            </div>

            <div className="modal-actions">
              <button onClick={handleCancel} className="btn-secondary">
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
          <div className="batch-translation-progress">
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

            <div className="progress-header">
              <p>
                {partialError
                  ? `Received ${partialTranslations.length} of ${totalCount} translations`
                  : `Translating ${completedIds.length} of ${totalCount} objects...`
                }
              </p>
              <div className="progress-bar">
                <div
                  className={`progress-fill ${partialError ? 'partial' : ''}`}
                  style={{ width: `${(completedIds.length / totalCount) * 100}%` }}
                />
              </div>
            </div>

            <div className="progress-list">
              {objectsToTranslate.map((obj, index) => {
                const isCompleted = completedIds.includes(obj.objectId);
                const isCurrent = !partialError && completedIds.length > 0 && completedIds[completedIds.length - 1] === obj.objectId;
                const isFailed = partialError && !isCompleted && index === completedIds.length;
                const isNotAttempted = partialError && !isCompleted && index > completedIds.length;

                return (
                  <div
                    key={obj.objectId}
                    className={`progress-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${isFailed ? 'failed' : ''} ${isNotAttempted ? 'not-attempted' : ''}`}
                  >
                    <span className="progress-icon">
                      {isCompleted ? '✓' : isFailed ? '✗' : isCurrent ? '⏳' : '○'}
                    </span>
                    <span className="progress-label">
                      {obj.objectType}: {obj.sourceData.name || obj.sourceData.title || obj.objectId}
                    </span>
                  </div>
                );
              })}
            </div>

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
                <button onClick={handleCancel} className="btn-secondary">
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Complete Screen */}
        {screen === 'complete' && (
          <div className="batch-translation-complete">
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

export default BatchTranslationModal;

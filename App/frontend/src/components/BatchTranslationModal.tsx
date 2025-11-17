import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { requestBatchTranslation } from '../services/batchTranslationService';
import type { StoryObjectToTranslate } from '../services/batchTranslationService';
import type { UnifiedObject, ObjectType } from '../types/unifiedObject';

interface BatchTranslationModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  onComplete: () => void;
}

type ScreenType = 'config' | 'progress' | 'complete';

interface ObjectTypeSelection {
  basicInfo: boolean;
  characters: boolean;
  organizations: boolean;
  locations: boolean;
  lorebook: boolean;
  acts: boolean;
  chapters: boolean;
}

const BatchTranslationModal: React.FC<BatchTranslationModalProps> = ({
  isOpen,
  onClose,
  projectId,
  onComplete,
}) => {
  const [screen, setScreen] = useState<ScreenType>('config');
  const [selectedTypes, setSelectedTypes] = useState<ObjectTypeSelection>({
    basicInfo: true,
    characters: true,
    organizations: true,
    locations: true,
    lorebook: true,
    acts: true,
    chapters: true,
  });
  const [sourceLanguage, setSourceLanguage] = useState<string>('');
  const [targetLanguage, setTargetLanguage] = useState<string>('');
  const [userInstructions, setUserInstructions] = useState('');
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);
  const store = useUnifiedObjectStore();
  const settings = useSettingsStore((state) => state.settings);

  // Initialize languages from settings
  useEffect(() => {
    if (isOpen && !sourceLanguage) {
      setSourceLanguage(settings.primaryLanguage);
      setTargetLanguage(settings.secondaryLanguage || '');
    }
  }, [isOpen, settings.primaryLanguage, settings.secondaryLanguage, sourceLanguage]);

  // Get objects that need translation
  const objectsToTranslate = useMemo(() => {
    if (!targetLanguage || !sourceLanguage) return [];

    const objects: StoryObjectToTranslate[] = [];
    const allObjects = Object.values(store.objects) as UnifiedObject<any>[];

    allObjects.forEach(obj => {
      if (obj.metadata?.project_id !== projectId) return;
      if (obj.languages?.available.includes(targetLanguage)) return; // Skip if already translated
      if (obj.languages?.active !== sourceLanguage) return; // Skip if not in source language

      const objType = obj.type;
      let include = false;

      if (objType === 'basic_info' && selectedTypes.basicInfo) include = true;
      if (objType === 'character' && selectedTypes.characters) include = true;
      if (objType === 'organization' && selectedTypes.organizations) include = true;
      if (objType === 'location' && selectedTypes.locations) include = true;
      if (objType === 'lorebook_entry' && selectedTypes.lorebook) include = true;
      if (objType === 'act' && selectedTypes.acts) include = true;
      if (objType === 'chapter' && selectedTypes.chapters) include = true;

      if (include) {
        objects.push({
          objectType: objType as ObjectType,
          objectId: obj.id,
          sourceData: obj.data,
        });
      }
    });

    return objects;
  }, [store.objects, projectId, targetLanguage, sourceLanguage, selectedTypes]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setScreen('config');
      setCompletedIds([]);
      setError(null);
      setUserInstructions('');
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

    try {
      await requestBatchTranslation({
        projectId,
        objects: objectsToTranslate,
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
        abortControllerRef,
      });

      // Success
      setScreen('complete');
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Translation failed');
      setScreen('complete');
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

  const toggleType = (type: keyof ObjectTypeSelection) => {
    setSelectedTypes(prev => ({ ...prev, [type]: !prev[type] }));
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
                  <option value={settings.primaryLanguage}>{settings.primaryLanguage}</option>
                  {settings.secondaryLanguage && (
                    <option value={settings.secondaryLanguage}>{settings.secondaryLanguage}</option>
                  )}
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
                  <option value={settings.primaryLanguage}>{settings.primaryLanguage}</option>
                  {settings.secondaryLanguage && (
                    <option value={settings.secondaryLanguage}>{settings.secondaryLanguage}</option>
                  )}
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Object Types to Translate</label>
              <div className="checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedTypes.basicInfo}
                    onChange={() => toggleType('basicInfo')}
                  />
                  <span>Basic Info</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedTypes.characters}
                    onChange={() => toggleType('characters')}
                  />
                  <span>Characters</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedTypes.organizations}
                    onChange={() => toggleType('organizations')}
                  />
                  <span>Organizations</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedTypes.locations}
                    onChange={() => toggleType('locations')}
                  />
                  <span>Locations</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedTypes.lorebook}
                    onChange={() => toggleType('lorebook')}
                  />
                  <span>Lorebook</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedTypes.acts}
                    onChange={() => toggleType('acts')}
                  />
                  <span>Acts</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selectedTypes.chapters}
                    onChange={() => toggleType('chapters')}
                  />
                  <span>Chapters</span>
                </label>
              </div>
            </div>

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
              <strong>{objectsToTranslate.length}</strong> objects will be translated
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
            <div className="progress-header">
              <p>Translating {completedIds.length} of {totalCount} objects...</p>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(completedIds.length / totalCount) * 100}%` }}
                />
              </div>
            </div>

            <div className="progress-list">
              {objectsToTranslate.map(obj => {
                const isCompleted = completedIds.includes(obj.objectId);
                const isCurrent = completedIds.length > 0 && completedIds[completedIds.length - 1] === obj.objectId;

                return (
                  <div
                    key={obj.objectId}
                    className={`progress-item ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''}`}
                  >
                    <span className="progress-icon">
                      {isCompleted ? '✓' : isCurrent ? '⏳' : '⏸'}
                    </span>
                    <span className="progress-label">
                      {obj.objectType}: {obj.sourceData.name || obj.sourceData.title || obj.objectId}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="modal-actions">
              <button onClick={handleCancel} className="btn-secondary">
                Cancel
              </button>
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

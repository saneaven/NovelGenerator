import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import { translateStoryObject, getDisplayDataForItem } from '../utils/storyObjectTranslation';
import type { BasicInfo } from '../types/storyObject';
import { createEmptyBasicInfo } from '../types/storyObject';

const BasicInfoManager: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const { getBasicInfo, updateBasicInfo, syncFlatFieldsWithLanguage } = useStoryObjectStore();
  const { settings } = useSettingsStore();
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<BasicInfo>(createEmptyBasicInfo());
  const [showAIModal, setShowAIModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  // Language state management
  const [currentLanguage, setCurrentLanguage] = useState(settings.primaryLanguage);
  const [isTranslating, setIsTranslating] = useState(false);

  const primaryLanguage = settings.primaryLanguage;
  const secondaryLanguage = settings.secondaryLanguage;

  // Get basic info directly from store - this will automatically re-render when store updates
  const basicInfo = projectId ? (getBasicInfo(projectId) || createEmptyBasicInfo()) : createEmptyBasicInfo();

  const handleSave = async () => {
    if (!projectId || !basicInfo.id) return;

    const itemId = basicInfo.id; // Capture itemId before any async operations
    const editLanguage = currentLanguage; // Capture current language

    updateBasicInfo(projectId, {
      title: editFormData.title,
      logline: editFormData.logline,
      genre: editFormData.genre,
    }, editLanguage);

    setIsEditing(false);

    // Check if primary language data exists in the new version
    setTimeout(async () => {
      const { hasItemDataInLanguage } = useStoryObjectStore.getState();
      const hasPrimaryLanguage = hasItemDataInLanguage(projectId, 'basicInfo', itemId, primaryLanguage);

      if (!hasPrimaryLanguage && editLanguage !== primaryLanguage) {
        // Ask user if they want to translate to primary language
        const shouldTranslate = confirm(
          `You edited the basic info in ${editLanguage}. Would you like to translate it to ${primaryLanguage}?`
        );

        if (shouldTranslate) {
          try {
            await translateStoryObject({
              projectId,
              category: 'basicInfo',
              itemId,
              sourceLanguage: editLanguage,
              targetLanguage: primaryLanguage,
              aiModel: settings.aiModel,
              onTranslating: setIsTranslating,
            });

            // Sync flat fields with primary language after translation
            syncFlatFieldsWithLanguage(projectId, 'basicInfo', itemId, primaryLanguage);
            setCurrentLanguage(primaryLanguage);
          } catch (error) {
            console.error('Translation failed:', error);
          }
        }
      }
    }, 100);
  };

  const handleCancel = () => {
    setEditFormData(basicInfo);
    setIsEditing(false);
  };

  const handleChange = (field: keyof Pick<BasicInfo, 'title' | 'logline' | 'genre'>, value: string) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleEdit = () => {
    setEditFormData(basicInfo);
    setIsEditing(true);
  };

  const handleAIResult = (result: any) => {    
    if (!projectId) return;
    
    if (result && typeof result === 'object') {
      const updates: Partial<Pick<BasicInfo, 'title' | 'logline' | 'genre'>> = {};
      
      if (result.title !== undefined) updates.title = result.title;
      if (result.logline !== undefined) updates.logline = result.logline;
      if (result.genre !== undefined) updates.genre = result.genre;
      
      // Use AI-specific update function that automatically creates version
      const { updateBasicInfoAI } = useStoryObjectStore.getState();
      updateBasicInfoAI(projectId, updates);
    }
  };

  const handleRestoreVersion = (versionData: any) => {
    if (!projectId) return;

    if (versionData && typeof versionData === 'object') {
      const updates: Partial<Pick<BasicInfo, 'title' | 'logline' | 'genre'>> = {};

      if (versionData.title !== undefined) updates.title = versionData.title;
      if (versionData.logline !== undefined) updates.logline = versionData.logline;
      if (versionData.genre !== undefined) updates.genre = versionData.genre;

      updateBasicInfo(projectId, updates);
    }
  };

  // Initialize and sync language on mount
  useEffect(() => {
    if (!projectId || !basicInfo.id) return;

    const displayInfo = getDisplayDataForItem(
      projectId,
      'basicInfo',
      basicInfo.id,
      primaryLanguage,
      primaryLanguage,
      secondaryLanguage
    );

    setCurrentLanguage(displayInfo.displayLanguage);
    syncFlatFieldsWithLanguage(projectId, 'basicInfo', basicInfo.id, displayInfo.displayLanguage);
  }, [projectId, basicInfo.id, primaryLanguage, secondaryLanguage]);

  // Sync flat fields when language changes
  useEffect(() => {
    if (!projectId || !basicInfo.id) return;
    syncFlatFieldsWithLanguage(projectId, 'basicInfo', basicInfo.id, currentLanguage);
  }, [currentLanguage, projectId, basicInfo.id]);

  const handleLanguageToggle = async () => {
    if (!projectId || !secondaryLanguage || !basicInfo.id) return;

    const targetLang = currentLanguage === secondaryLanguage ? primaryLanguage : secondaryLanguage;

    const { hasItemDataInLanguage, getAvailableLanguagesForItem, getItemDataInLanguage } = useStoryObjectStore.getState();
    const hasTargetLang = hasItemDataInLanguage(projectId, 'basicInfo', basicInfo.id, targetLang);

    if (hasTargetLang) {
      setCurrentLanguage(targetLang);
      return;
    }

    // Need to translate
    const availableLanguages = getAvailableLanguagesForItem(projectId, 'basicInfo', basicInfo.id);
    if (availableLanguages.length === 0) return;

    const sourceLang = availableLanguages.includes(currentLanguage) ? currentLanguage : availableLanguages[0];

    // Validate source data before translation
    const sourceData = getItemDataInLanguage(projectId, 'basicInfo', basicInfo.id, sourceLang);
    if (!sourceData || (!sourceData.title?.trim() && !sourceData.logline?.trim() && !sourceData.genre?.trim())) {
      alert(`Cannot translate: No content in ${sourceLang} version. Please add content first.`);
      return;
    }

    try {
      await translateStoryObject({
        projectId,
        category: 'basicInfo',
        itemId: basicInfo.id,
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        aiModel: settings.aiModel,
        onTranslating: setIsTranslating,
      });

      setCurrentLanguage(targetLang);
    } catch (error) {
      console.error('Translation failed:', error);
    }
  };

  if (!projectId) {
    return (
      <div className="error-container">
        <p>Project ID not found.</p>
      </div>
    );
  }

  const displayInfo = projectId && basicInfo.id
    ? getDisplayDataForItem(projectId, 'basicInfo', basicInfo.id, currentLanguage, primaryLanguage, secondaryLanguage)
    : { data: null, displayLanguage: currentLanguage, hasRequestedLanguage: true, fallbackLanguage: null, availableLanguages: [] };

  const showMissingLanguageWarning = !displayInfo.hasRequestedLanguage && displayInfo.fallbackLanguage;

  return (
    <div className="basic-info-manager">
      <div className="section-header">
        <h2>Basic Information</h2>
        {!isEditing ? (
          <div className="header-buttons">
            {secondaryLanguage && (
              <button
                onClick={handleLanguageToggle}
                className="translate-button"
                disabled={isTranslating}
                title={`Translate to ${currentLanguage === secondaryLanguage ? primaryLanguage : secondaryLanguage}`}
              >
                {isTranslating ? '⏳ Translating...' : `🌐 ${currentLanguage}`}
              </button>
            )}
            <button onClick={() => setShowVersionHistory(true)} className="version-history-button">
              📚 Version History
            </button>
            <button onClick={() => setShowAIModal(true)} className="ai-edit-button">
              🤖 AI Edit
            </button>
            <button onClick={handleEdit} className="edit-button">
              Edit
            </button>
          </div>
        ) : (
          <div className="edit-buttons">
            <button onClick={handleSave} className="save-button">
              Save
            </button>
            <button onClick={handleCancel} className="cancel-button">
              Cancel
            </button>
          </div>
        )}
      </div>

      {showMissingLanguageWarning && (
        <div className="missing-language-warning">
          <p>⚠️ No {currentLanguage} version available. Displaying {displayInfo.fallbackLanguage} version.</p>
          <button
            onClick={handleLanguageToggle}
            className="generate-translation-button"
            disabled={isTranslating}
          >
            {isTranslating ? 'Generating...' : `Generate ${currentLanguage} Version`}
          </button>
        </div>
      )}

      <div className="basic-info-content">
        <div className="form-group">
          <label htmlFor="title">Title</label>
          {isEditing ? (
            <input
              id="title"
              type="text"
              value={editFormData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="Enter the title of the novel"
            />
          ) : (
            <div className="display-value">
              {basicInfo.title || 'Title not set.'}
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="genre">Genre</label>
          {isEditing ? (
            <input
              id="genre"
              type="text"
              value={editFormData.genre}
              onChange={(e) => handleChange('genre', e.target.value)}
              placeholder="Enter the genre (e.g., Fantasy, Romance, Sci-Fi)"
            />
          ) : (
            <div className="display-value">
              {basicInfo.genre || 'Genre not set.'}
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="logline">Logline</label>
          {isEditing ? (
            <textarea
              id="logline"
              value={editFormData.logline}
              onChange={(e) => handleChange('logline', e.target.value)}
              placeholder="Summarize the core content of the novel in one or two sentences"
              rows={4}
            />
          ) : (
            <div className="display-value multiline">
              {basicInfo.logline || 'Logline not set.'}
            </div>
          )}
        </div>

        <div className="metadata">
          <span className="item-language">Language: {currentLanguage}</span>
          {basicInfo.updatedAt && (
            <span className="last-updated">
              Last updated: {basicInfo.updatedAt.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <AIEditModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        category="basicInfo"
        projectId={projectId || ''}
        targetId={basicInfo.id}
        onResult={handleAIResult}
      />

      {basicInfo.id && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          projectId={projectId || ''}
          category="basicInfo"
          targetId={basicInfo.id}
          onRestoreVersion={handleRestoreVersion}
        />
      )}
    </div>
  );
};

export default BasicInfoManager;
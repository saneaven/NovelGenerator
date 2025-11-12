/**
 * BasicInfoManager - Migrated to New Unified Translation System
 *
 * Changes from old system:
 * - Uses useUnifiedObjectStore instead of useStoryObjectStore
 * - Direct data access (no useLanguageAwareData hook)
 * - LanguageSwitcher component for language switching
 * - Simplified save logic (no manual sync)
 * - Cleaner translation flow
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { LanguageSwitcher } from './LanguageSwitcher';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import { TranslationService } from '../services/translationService';
import type { BasicInfoObject, BasicInfoData } from '../types/unifiedObject';

const BasicInfoManager: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const objects = useUnifiedObjectStore((state) => state.objects);
  const loadingMap = useUnifiedObjectStore((state) => state.loading);
  const errors = useUnifiedObjectStore((state) => state.errors);
  const fetchObject = useUnifiedObjectStore((state) => state.fetchObject);
  const updateObject = useUnifiedObjectStore((state) => state.updateObject);
  const switchLanguage = useUnifiedObjectStore((state) => state.switchLanguage);
  const activateVersion = useUnifiedObjectStore((state) => state.activateVersion);
  const listObjects = useUnifiedObjectStore((state) => state.listObjects);
  const createObject = useUnifiedObjectStore((state) => state.createObject);
  const { settings } = useSettingsStore();

  // Get basic info from unified store
  // In real implementation, you'd need to get the basic info ID first
  // For now, assuming there's one basic info per project
  const [basicInfoId, setBasicInfoId] = useState<string | null>(null);
  const basicInfo = basicInfoId ? (objects[basicInfoId] as BasicInfoObject) : null;
  const loading = basicInfoId ? (loadingMap[basicInfoId] || false) : false;
  const error = basicInfoId ? (errors[basicInfoId] || null) : null;
  const [initializing, setInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<BasicInfoData>({
    title: '',
    logline: '',
    genre: '',
  });

  // Modal state
  const [showAIModal, setShowAIModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Fetch basic info ID on mount (you'll need to implement this based on your API)
  const initializeBasicInfo = useCallback(async () => {
    if (!projectId) {
      setBasicInfoId(null);
      return;
    }

    setInitializing(true);
    setInitializationError(null);

    try {
      const existing = await listObjects('basic_info', projectId);
      if (existing.length > 0) {
        setBasicInfoId(existing[0].id);
        return;
      }

      const newBasicInfo = await createObject(
        'basic_info',
        projectId,
        {
          title: '',
          logline: '',
          genre: '',
        },
        settings.primaryLanguage
      );
      setBasicInfoId(newBasicInfo.id);
    } catch (err) {
      console.error('Failed to initialize basic info:', err);
      setInitializationError(
        err instanceof Error ? err.message : 'Failed to load basic info'
      );
    } finally {
      setInitializing(false);
    }
  }, [projectId, listObjects, createObject, settings.primaryLanguage]);

  useEffect(() => {
    setBasicInfoId(null);
    initializeBasicInfo();
  }, [initializeBasicInfo]);

  // Fetch basic info when ID is available
  useEffect(() => {
    if (basicInfoId) {
      fetchObject('basic_info', basicInfoId);
    }
  }, [basicInfoId, fetchObject]);

  // Sync edit form when basic info loads or language changes
  useEffect(() => {
    if (basicInfo?.data) {
      setEditFormData(basicInfo.data);
    }
  }, [basicInfo?.data]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleSave = async () => {
    if (!basicInfo || !basicInfoId) return;

    setIsSaving(true);
    try {
      await updateObject('basic_info', basicInfoId, {
        data: editFormData,
        language: basicInfo.languages.active,
        user_request: 'User Edit',
        create_new_version: true,
      });

      setIsEditing(false);
      console.log('✓ Basic info saved successfully');
    } catch (err) {
      console.error('Failed to save basic info:', err);
      alert('Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (basicInfo?.data) {
      setEditFormData(basicInfo.data);
    }
    setIsEditing(false);
  };

  const handleChange = (field: keyof BasicInfoData, value: string) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleEdit = () => {
    if (basicInfo?.data) {
      setEditFormData(basicInfo.data);
    }
    setIsEditing(true);
  };

  const handleLanguageChange = async (newLanguage: string) => {
    if (!basicInfo || !basicInfoId) return;

    try {
      // Clean language switch - NO version created!
      await switchLanguage('basic_info', basicInfoId, newLanguage);
      console.log(`✓ Switched to ${newLanguage}`);
    } catch (err) {
      console.error('Failed to switch language:', err);
      alert('Failed to switch language. Please try again.');
    }
  };

  const handleAddTranslation = async () => {
    if (!basicInfo || !basicInfoId || !projectId) return;

    const targetLanguage = settings.secondaryLanguage;
    if (!targetLanguage) {
      alert('Please set a secondary language in settings first.');
      return;
    }

    // Check if translation already exists
    if (basicInfo.languages.available.includes(targetLanguage)) {
      alert(`${targetLanguage} translation already exists.`);
      return;
    }

    try {
      TranslationService.setTranslationStatus(basicInfoId, { objectId: basicInfoId, isTranslating: true });
      await TranslationService.requestTranslation({
        projectId,
        sourceLanguage: basicInfo.languages.active,
        targetLanguage,
        dataType: 'basicInfo',
        sourceData: {
          title: basicInfo.data.title,
          logline: basicInfo.data.logline,
          genre: basicInfo.data.genre,
        },
        translationContext: {
          projectId,
          targetLanguage,
        },
      });

      console.log(`✓ Added ${targetLanguage} translation`);
      alert(`Translation added for ${targetLanguage}`);
    } catch (err) {
      console.error('Failed to add translation:', err);
      alert(err instanceof Error ? err.message : 'Failed to add translation. Please try again.');
    } finally {
      TranslationService.clearTranslationStatus(basicInfoId);
    }
  };

  const handleAIResult = async (result: any) => {
    if (!basicInfo || !basicInfoId || !result) return;

    try {
      const updates: Partial<BasicInfoData> = {};
      if (result.title !== undefined) updates.title = result.title;
      if (result.logline !== undefined) updates.logline = result.logline;
      if (result.genre !== undefined) updates.genre = result.genre;

      await updateObject('basic_info', basicInfoId, {
        data: { ...basicInfo.data, ...updates },
        language: basicInfo.languages.active,
        user_request: 'AI Edit',
        create_new_version: true,
      });

      console.log('✓ AI edit applied');
    } catch (err) {
      console.error('Failed to apply AI edit:', err);
      alert('Failed to apply AI edit. Please try again.');
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!basicInfo || !basicInfoId) return;

    try {
      await activateVersion('basic_info', basicInfoId, versionId);
      console.log('✓ Version restored');
    } catch (err) {
      console.error('Failed to restore version:', err);
      alert('Failed to restore version. Please try again.');
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!projectId) {
    return (
      <div className="error-container">
        <p>Project ID not found.</p>
      </div>
    );
  }

  if (loading && !basicInfo) {
    return (
      <div className="basic-info-manager loading">
        <div className="spinner" />
        <p>Loading basic information...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="error-container">
        <h3>Error Loading Basic Info</h3>
        <p>{error}</p>
        <button onClick={() => basicInfoId && fetchObject('basic_info', basicInfoId)}>
          Retry
        </button>
      </div>
    );
  }

  if (initializationError && !basicInfo) {
    return (
      <div className="error-container">
        <h3>Unable to load basic info</h3>
        <p>{initializationError}</p>
        <button onClick={initializeBasicInfo} disabled={initializing}>
          Retry
        </button>
      </div>
    );
  }

  if (initializing && !basicInfo) {
    return (
      <div className="basic-info-manager loading">
        <div className="spinner" />
        <p>Loading basic information...</p>
      </div>
    );
  }

  if (!basicInfo) {
    return (
      <div className="error-container">
        <p>Basic information not found for this project.</p>
      </div>
    );
  }

  return (
    <div className="basic-info-manager">
      <div className="section-header">
        <h2>Basic Information</h2>
        {!isEditing ? (
          <div className="header-buttons">
            <LanguageSwitcher
              object={basicInfo}
              onLanguageChange={handleLanguageChange}
              disabled={loading}
            />
            {settings.secondaryLanguage &&
              !basicInfo.languages.available.includes(settings.secondaryLanguage) && (
                <button
                  onClick={handleAddTranslation}
                  className="translate-button"
                  disabled={loading}
                  title={`Translate to ${settings.secondaryLanguage}`}
                >
                  🌐 Add {settings.secondaryLanguage}
                </button>
              )}
            <button
              onClick={() => setShowVersionHistory(true)}
              className="version-history-button"
              disabled={loading}
            >
              📚 Version History
            </button>
            <button
              onClick={() => setShowAIModal(true)}
              className="ai-edit-button"
              disabled={loading}
            >
              🤖 AI Edit
            </button>
            <button onClick={handleEdit} className="edit-button" disabled={loading}>
              Edit
            </button>
          </div>
        ) : (
          <div className="edit-buttons">
            <button
              onClick={handleSave}
              className="save-button"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleCancel}
              className="cancel-button"
              disabled={isSaving}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div className="basic-info-content">
        {/* Title */}
        <div className="form-group">
          <label htmlFor="title">Title</label>
          {isEditing ? (
            <input
              id="title"
              type="text"
              value={editFormData.title}
              onChange={(e) => handleChange('title', e.target.value)}
              placeholder="Enter the title of the novel"
              disabled={isSaving}
            />
          ) : (
            <div className="display-value">
              {basicInfo.data.title || 'Title not set.'}
            </div>
          )}
        </div>

        {/* Genre */}
        <div className="form-group">
          <label htmlFor="genre">Genre</label>
          {isEditing ? (
            <input
              id="genre"
              type="text"
              value={editFormData.genre}
              onChange={(e) => handleChange('genre', e.target.value)}
              placeholder="Enter the genre (e.g., Fantasy, Romance, Sci-Fi)"
              disabled={isSaving}
            />
          ) : (
            <div className="display-value">
              {basicInfo.data.genre || 'Genre not set.'}
            </div>
          )}
        </div>

        {/* Logline */}
        <div className="form-group">
          <label htmlFor="logline">Logline</label>
          {isEditing ? (
            <textarea
              id="logline"
              value={editFormData.logline}
              onChange={(e) => handleChange('logline', e.target.value)}
              placeholder="Summarize the core content of the novel in one or two sentences"
              rows={4}
              disabled={isSaving}
            />
          ) : (
            <div className="display-value multiline">
              {basicInfo.data.logline || 'Logline not set.'}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="metadata">
          <span className="item-language">
            Language: {basicInfo.languages.active}
          </span>
          <span className="version-info">
            Version: {basicInfo.version.number}
          </span>
          {basicInfo.metadata.updated_at && (
            <span className="last-updated">
              Last updated: {new Date(basicInfo.metadata.updated_at).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* AI Edit Modal */}
      <AIEditModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        category="basicInfo"
        projectId={projectId}
        targetId={basicInfoId || ''}
        onResult={handleAIResult}
      />

      {/* Version History Modal */}
      {basicInfoId && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          objectType="basic_info"
          objectId={basicInfoId!}
          onRestoreVersion={handleRestoreVersion}
        />
      )}
    </div>
  );
};

export default BasicInfoManager;

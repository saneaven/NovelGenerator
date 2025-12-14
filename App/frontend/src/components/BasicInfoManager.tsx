/**
 * BasicInfoManager - Using Global Language Toggle
 *
 * Uses global display language from parent (StoryPanel) instead of per-object switching.
 * Shows warning icon when displaying in fallback language.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import TranslationModal from './TranslationModal';
import { DropdownMenu, DropdownItem } from './ui/DropdownMenu';
import { Edit, Refresh, Books, AIAssist, Warning } from './icons';
import type { BasicInfoObject, BasicInfoData } from '../types/unifiedObject';

interface BasicInfoManagerProps {
  globalDisplayLanguage: string;
}

const BasicInfoManager: React.FC<BasicInfoManagerProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const objects = useUnifiedObjectStore((state) => state.objects);
  const loadingMap = useUnifiedObjectStore((state) => state.loading);
  const errors = useUnifiedObjectStore((state) => state.errors);
  const fetchObject = useUnifiedObjectStore((state) => state.fetchObject);
  const updateObject = useUnifiedObjectStore((state) => state.updateObject);
  const restoreVersion = useUnifiedObjectStore((state) => state.restoreVersion);
  const listObjects = useUnifiedObjectStore((state) => state.listObjects);
  const createObject = useUnifiedObjectStore((state) => state.createObject);
  const { settings } = useSettingsStore();
  const { showError } = useErrorStore();

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
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Helper to get data for a specific language
  const getDataForLanguage = useCallback((lang: string): BasicInfoData => {
    if (!basicInfo) return { title: '', logline: '', genre: '' };
    const data = basicInfo.data[lang];
    if (data) return data as BasicInfoData;
    // Fallback to first available language
    const availableLanguages = Object.keys(basicInfo.data);
    if (availableLanguages.length > 0) {
      return basicInfo.data[availableLanguages[0]] as BasicInfoData;
    }
    return { title: '', logline: '', genre: '' };
  }, [basicInfo]);

  // Compute effective display language with fallback
  const { effectiveLanguage, isFallback } = useMemo(() => {
    if (!basicInfo) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    const available = Object.keys(basicInfo.data);
    if (available.includes(globalDisplayLanguage)) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    // Fallback to any available language
    return { effectiveLanguage: available[0] || globalDisplayLanguage, isFallback: true };
  }, [basicInfo, globalDisplayLanguage]);

  // Get current data for effective language
  const currentData = useMemo(() => getDataForLanguage(effectiveLanguage), [getDataForLanguage, effectiveLanguage]);

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
        settings.mainLanguage
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
  }, [projectId, listObjects, createObject, settings.mainLanguage]);

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
    if (currentData) {
      setEditFormData(currentData);
    }
  }, [currentData]);

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleSave = async () => {
    if (!basicInfo || !basicInfoId) return;

    setIsSaving(true);
    try {
      await updateObject('basic_info', basicInfoId, {
        data: editFormData,
        language: effectiveLanguage,
        user_request: 'User Edit',
        create_new_version: true,
      });

      setIsEditing(false);
    } catch (err) {
      console.error('Failed to save basic info:', err);
      showError('Save Error', 'Failed to save. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditFormData(currentData);
    setIsEditing(false);
  };

  const handleChange = (field: keyof BasicInfoData, value: string) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleEdit = () => {
    setEditFormData(currentData);
    setIsEditing(true);
  };

  const handleAIResult = async (result: any) => {
    if (!basicInfo || !basicInfoId || !result) return;

    try {
      const updates: Partial<BasicInfoData> = {};
      if (result.title !== undefined) updates.title = result.title;
      if (result.logline !== undefined) updates.logline = result.logline;
      if (result.genre !== undefined) updates.genre = result.genre;

      await updateObject('basic_info', basicInfoId, {
        data: { ...currentData, ...updates },
        language: effectiveLanguage,
        user_request: 'AI Edit',
        create_new_version: true,
      });

    } catch (err) {
      console.error('Failed to apply AI edit:', err);
      showError('AI Edit Error', 'Failed to apply AI edit. Please try again.');
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!basicInfo || !basicInfoId) return;

    try {
      await restoreVersion('basic_info', basicInfoId, versionId);
    } catch (err) {
      console.error('Failed to restore version:', err);
      showError('Restore Error', 'Failed to restore version. Please try again.');
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
          <div className="card-actions">
            <button onClick={handleEdit} className="card-edit-btn desktop-only" disabled={loading}>
              Edit
            </button>
            <DropdownMenu
              trigger={
                <button className="more-button" disabled={loading} title="More actions">
                  •••
                </button>
              }
            >
              <DropdownItem
                icon={<Edit size="sm" />}
                label="Edit"
                onClick={handleEdit}
                disabled={loading}
                className="mobile-only"
              />
              {settings.defaultSubLanguage &&
                Object.keys(basicInfo.data).includes(settings.defaultSubLanguage) && (
                  <DropdownItem
                    icon={<Refresh size="sm" />}
                    label="Retranslate"
                    onClick={() => setShowRetranslateModal(true)}
                    disabled={loading}
                  />
              )}
              <DropdownItem
                icon={<Books size="sm" />}
                label="History"
                onClick={() => setShowVersionHistory(true)}
                disabled={loading}
              />
            </DropdownMenu>
          </div>
        ) : (
          <div className="form-actions-split">
            <button
              onClick={() => setShowAIModal(true)}
              className="ai-edit-btn"
              disabled={isSaving}
            >
              <AIAssist size="sm" /> AI Edit
            </button>
            <div className="form-actions-right">
              <button
                onClick={handleCancel}
                className="cancel-button"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="save-button"
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
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
              {currentData.title || 'Title not set.'}
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
              {currentData.genre || 'Genre not set.'}
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
              {currentData.logline || 'Logline not set.'}
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="metadata">
          <span className="item-language">
            {isFallback && <span className="fallback-warning" title={`${globalDisplayLanguage} not available, showing ${effectiveLanguage}`}><Warning size="sm" /> </span>}
            Language: {effectiveLanguage}
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
        category="basic_info"
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

      {/* Translation Modal */}
      {basicInfo && basicInfoId && projectId && (
        <TranslationModal
          isOpen={showRetranslateModal}
          onClose={() => setShowRetranslateModal(false)}
          projectId={projectId}
          onComplete={() => setShowRetranslateModal(false)}
          allowedObjectTypes={['basic_info']}
          preSelectedObjectIds={[basicInfoId]}
          defaultSourceLanguage={settings.mainLanguage}
          defaultTargetLanguage={globalDisplayLanguage}
        />
      )}
    </div>
  );
};

export default BasicInfoManager;

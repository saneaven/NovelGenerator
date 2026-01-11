/**
 * BasicInfoManager - Modern Image Card Design
 *
 * Uses global display language from parent (StoryObjectPanel) instead of per-object switching.
 * Shows warning icon when displaying in fallback language.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import './BasicInfoManager.css';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import { API_BASE_URL } from '../api/client';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import TranslationModal from './TranslationModal';
import { UnifiedImageModal } from './AssetManager';
import { DropdownMenu, DropdownItem } from './ui/DropdownMenu';
import { IconButton } from './IconButton';
import { TextButton } from './TextButton';
import { Edit, Refresh, Books, AIAssist, Warning, MoreHorizontal, Image, Save, Close } from './icons';
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
  const listObjects = useUnifiedObjectStore((state) => state.listObjects);
  const { settings } = useSettingsStore();
  const { showError } = useErrorStore();

  // Get basic info from unified store
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
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Helper to get data for a specific language
  const getDataForLanguage = useCallback((lang: string): BasicInfoData => {
    if (!basicInfo) return { title: '', logline: '', genre: '' };
    const data = basicInfo.data[lang];
    if (data) return data as BasicInfoData;
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
    return { effectiveLanguage: available[0] || globalDisplayLanguage, isFallback: true };
  }, [basicInfo, globalDisplayLanguage]);

  const currentData = useMemo(() => getDataForLanguage(effectiveLanguage), [getDataForLanguage, effectiveLanguage]);

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
      } else {
        // BasicInfo should be auto-created with the project
        setInitializationError('BasicInfo not found. This should not happen.');
      }
    } catch (err) {
      console.error('Failed to initialize basic info:', err);
      setInitializationError(
        err instanceof Error ? err.message : 'Failed to load basic info'
      );
    } finally {
      setInitializing(false);
    }
  }, [projectId, listObjects]);

  useEffect(() => {
    setBasicInfoId(null);
    initializeBasicInfo();
  }, [initializeBasicInfo]);

  useEffect(() => {
    if (basicInfoId) {
      fetchObject('basic_info', basicInfoId);
    }
  }, [basicInfoId, fetchObject]);

  useEffect(() => {
    if (currentData) {
      setEditFormData(currentData);
    }
  }, [currentData]);

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

  // Called after modal restores a version - just refresh the object
  const handleRestoreVersion = async () => {
    if (!basicInfoId) return;
    try {
      await fetchObject('basic_info', basicInfoId);
    } catch (err) {
      console.error('Failed to refresh after restore:', err);
    }
  };

  const coverImageUrl = basicInfo?.metadata?.cover_image_url;

  if (!projectId) return <div className="error-container">Project ID not found.</div>;
  if (loading && !basicInfo) return <div className="basic-info-skeleton"><div className="spinner" /></div>;
  if (error) return <div className="error-container"><p>{error}</p><button onClick={() => basicInfoId && fetchObject('basic_info', basicInfoId)}>Retry</button></div>;
  if (initializationError && !basicInfo) return <div className="error-container"><p>{initializationError}</p><button onClick={initializeBasicInfo} disabled={initializing}>Retry</button></div>;
  if (initializing && !basicInfo) return <div className="basic-info-skeleton"><div className="spinner" /></div>;
  if (!basicInfo) return <div className="error-container">Basic information not found.</div>;

  return (
    <div className="basic-info-manager">
      <div className="section-header">
        <h2>Basic Information</h2>
        {!isEditing ? (
          <div className="header-buttons">
            <TextButton
              variant="ghost"
              size="sm"
              onClick={() => setShowAIModal(true)}
              disabled={loading}
              iconLeft={<AIAssist size="xs" />}
              className="desktop-only"
            >
              AI Edit
            </TextButton>
            <TextButton
              variant="ghost"
              size="sm"
              onClick={() => setShowVersionHistory(true)}
              disabled={loading}
              iconLeft={<Books size="xs" />}
              className="desktop-only"
            >
              History
            </TextButton>
            <TextButton
              variant="secondary"
              size="sm"
              onClick={handleEdit}
              disabled={loading}
              className="desktop-only"
            >
              Edit
            </TextButton>
            <DropdownMenu
              trigger={
                <IconButton
                  icon={<MoreHorizontal size="sm" />}
                  disabled={loading}
                  title="More actions"
                  size="sm"
                  className="mobile-only"
                />
              }
            >
              <DropdownItem
                icon={<Edit size="sm" />}
                label="Edit"
                onClick={handleEdit}
                disabled={loading}
              />
              <DropdownItem
                icon={<AIAssist size="sm" />}
                label="AI Edit"
                onClick={() => setShowAIModal(true)}
                disabled={loading}
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
            <div className="form-actions-split" style={{ width: 'auto', margin: 0, padding: 0, border: 'none' }}>
               {/* Actions are now mainly handled in the card footer, but we can keep some here or leave empty */}
            </div>
        )}
      </div>
      <div className="section-divider" />
      
      <div className="basic-info-layout">
      <div className={`basic-info-card ${isEditing ? 'is-editing' : ''}`}>
        
        {/* Left Column: Cover Image */}
        <div className="basic-info-media">
          {coverImageUrl ? (
            <div className="media-preview">
              <img src={`${API_BASE_URL}${coverImageUrl}`} alt="Book Cover" className="book-cover-img" />
              <button className="media-edit-overlay" onClick={() => setShowAssetPicker(true)}>
                <Image size="md" />
                <span>Change Cover</span>
              </button>
            </div>
          ) : (
            <div className="media-placeholder" onClick={() => setShowAssetPicker(true)}>
              <Image size="xl" />
              <span>Set Cover Image</span>
            </div>
          )}
        </div>

        {/* Right Column: Content */}
        <div className="basic-info-details">
          
          {/* Header Section: Title & Genre */}
          <header className="details-header">
              <div className="meta-badge-group">
                {isEditing ? (
                  <input
                    type="text"
                    className="genre-input"
                    value={editFormData.genre}
                    onChange={(e) => handleChange('genre', e.target.value)}
                    placeholder="Genre"
                  />
                ) : (
                  <span className="genre-badge">{currentData.genre || 'Uncategorized'}</span>
                )}
                {isFallback && (
                  <span className="language-badge warning" title={`Showing ${effectiveLanguage}`}>
                    <Warning size="xs" /> {effectiveLanguage}
                  </span>
                )}
              </div>

            {isEditing ? (
              <input
                type="text"
                className="title-input"
                value={editFormData.title}
                onChange={(e) => handleChange('title', e.target.value)}
                placeholder="Book Title"
                autoFocus
              />
            ) : (
              <h1 className="title-display">{currentData.title || 'Untitled Story'}</h1>
            )}
          </header>

          {/* Body Section: Logline */}
          <div className="details-body">
            <label className="section-label">Logline</label>
            {isEditing ? (
              <textarea
                className="logline-input"
                value={editFormData.logline}
                onChange={(e) => handleChange('logline', e.target.value)}
                placeholder="What is your story about?"
                rows={5}
              />
            ) : (
              <p className="logline-display">
                {currentData.logline || <span className="placeholder-text">No logline provided. Click edit to add a description of your story.</span>}
              </p>
            )}
          </div>

          {/* Footer Section: Actions (Edit Mode) or Meta (View Mode) */}
          <footer className="details-footer">
            {isEditing ? (
              <div className="edit-actions">
                <TextButton
                  onClick={handleCancel}
                  variant="secondary"
                  size="sm"
                  disabled={isSaving}
                  iconLeft={<Close size="sm" />}
                >
                  Cancel
                </TextButton>
                <TextButton
                  onClick={handleSave}
                  variant="primary"
                  size="sm"
                  loading={isSaving}
                  disabled={isSaving}
                  iconLeft={<Save size="sm" />}
                >
                  Save Changes
                </TextButton>
              </div>
            ) : (
              <div className="meta-info">
                 <span>v{basicInfo.version.number}</span>
                 <span className="separator">•</span>
                 <span>Last updated {new Date(basicInfo.metadata.updated_at || Date.now()).toLocaleDateString()}</span>
              </div>
            )}
          </footer>
        </div>
      </div>
      </div>

      {/* Modals */}
      <AIEditModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        category="basic_info"
        projectId={projectId}
        targetId={basicInfoId ?? undefined}
      />

      {basicInfoId && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          objectType="basic_info"
          objectId={basicInfoId!}
          onRestoreVersion={handleRestoreVersion}
        />
      )}

      {basicInfo && basicInfoId && projectId && (
        <TranslationModal
          isOpen={showRetranslateModal}
          onClose={() => setShowRetranslateModal(false)}
          projectId={projectId}
          allowedObjectTypes={['basic_info']}
          preSelectedObjectIds={[basicInfoId]}
          defaultSourceLanguage={settings.mainLanguage}
          defaultTargetLanguage={globalDisplayLanguage}
        />
      )}

      {basicInfoId && (
        <UnifiedImageModal
          preset="objectManager"
          isOpen={showAssetPicker}
          onClose={() => setShowAssetPicker(false)}
          objectType="basic_info"
          objectId={basicInfoId}
          onAssetChange={() => fetchObject('basic_info', basicInfoId)}
          title="Manage Cover Image"
        />
      )}
    </div>
  );
};

export default BasicInfoManager;

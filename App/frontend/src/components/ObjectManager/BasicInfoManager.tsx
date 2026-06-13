/**
 * BasicInfoManager - Modern Image Card Design
 *
 * Uses global display language from parent (StoryEntityPanel) instead of per-object switching.
 * Shows warning icon when displaying in fallback language.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import './BasicInfoManager.css';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettings } from '../../store/settingsStore';
import { alert as showAlert } from '../../store/dialogStore';
import { useAssetStore } from '../../store/assetStore';
import { getAssetUrl } from '../../utils/assetUrl';
import AIEditModal from '../Modal/AIEditModal';
import VersionHistoryModal from '../Modal/VersionHistoryModal';
import TranslationModal from '../Modal/TranslationModal';
import { UnifiedImageModal } from '../AssetManager';
import AuthenticatedImage from '../common/AuthenticatedImage';
import { DropdownMenu, DropdownItem } from '../ui/DropdownMenu';
import StringChipInput from '../ui/StringChipInput';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import { Edit, Refresh, Books, AIAssist, Warning, MoreHorizontal, Image, Save, Close } from '../icons';
import { Loading } from '../common/Loading';
import type { BasicInfoObject, BasicInfoData } from '../../types/unifiedObject';
import { normalizeBasicInfoData } from '../../utils/basicInfo';
import {
  requestedLanguageStateFromProjection,
  resolveTranslationSourceLanguage,
} from '../../utils/requestedLanguage';

interface BasicInfoManagerProps {
  globalDisplayLanguage: string;
}

const EMPTY_BASIC_INFO_DATA: BasicInfoData = {
  title: '',
  logline: '',
  genres: [],
  tags: [],
};

const BasicInfoManager: React.FC<BasicInfoManagerProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const objects = useUnifiedObjectStore((state) => state.getObjectsForProject(projectId ?? '', globalDisplayLanguage));
  const loadingMap = useUnifiedObjectStore((state) => state.loading);
  const errors = useUnifiedObjectStore((state) => state.errors);
  const fetchObject = useUnifiedObjectStore((state) => state.fetchObject);
  const updateObject = useUnifiedObjectStore((state) => state.updateObject);
  const listObjects = useUnifiedObjectStore((state) => state.listObjects);
  const settings = useSettings();
  // Get basic info from unified store
  const [basicInfoId, setBasicInfoId] = useState<string | null>(null);
  const basicInfo = basicInfoId ? (objects[basicInfoId] as BasicInfoObject) : null;
  const loading = basicInfoId ? (loadingMap[basicInfoId] || false) : false;
  const error = basicInfoId ? (errors[basicInfoId] || null) : null;
  const [initializing, setInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<BasicInfoData>(EMPTY_BASIC_INFO_DATA);

  // Modal state
  const [showAIModal, setShowAIModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Helper to get data for a specific language
  const getDataForLanguage = useCallback((lang: string): BasicInfoData => {
    void lang;
    if (!basicInfo) return EMPTY_BASIC_INFO_DATA;
    return normalizeBasicInfoData(basicInfo.data);
  }, [basicInfo]);

  const languageState = useMemo(
    () => requestedLanguageStateFromProjection(basicInfo?.language_state, settings.mainLanguage),
    [basicInfo, globalDisplayLanguage, settings.mainLanguage],
  );

  const currentData = useMemo(
    () => getDataForLanguage(languageState.viewLanguage),
    [getDataForLanguage, languageState.viewLanguage],
  );

  const canTranslate = languageState.isTranslationView && !languageState.hasRequestedLanguage;
  const canRetranslate = languageState.isTranslationView && languageState.hasRequestedLanguage;
  const showAIEdit = languageState.isMainLanguage;

  const initializeBasicInfo = useCallback(async () => {
    if (!projectId) {
      setBasicInfoId(null);
      return;
    }

    setInitializing(true);
    setInitializationError(null);

    try {
      const existing = await listObjects('basic_info', projectId, globalDisplayLanguage);
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
  }, [globalDisplayLanguage, projectId, listObjects]);

  useEffect(() => {
    setBasicInfoId(null);
    initializeBasicInfo();
  }, [initializeBasicInfo]);

  useEffect(() => {
    if (basicInfoId) {
      fetchObject('basic_info', basicInfoId, globalDisplayLanguage);
    }
  }, [basicInfoId, fetchObject, globalDisplayLanguage]);

  useEffect(() => {
    if (currentData && !isEditing) {
      setEditFormData(currentData);
    }
  }, [currentData, isEditing]);

  useEffect(() => {
    if (isEditing && !languageState.canEdit) {
      setIsEditing(false);
    }
  }, [isEditing, languageState.canEdit]);

  const handleSave = async () => {
    if (!basicInfo || !basicInfoId || !languageState.canEdit) return;

    setIsSaving(true);
    try {
      await updateObject('basic_info', basicInfoId, {
        data: editFormData,
        language: languageState.requestedLanguage,
        user_request: 'User Edit',
        create_new_version: languageState.createNewVersion,
      });

      setIsEditing(false);
    } catch (err) {
      console.error('Failed to save basic info:', err);
      showAlert({ title: 'Save Error', message: 'Failed to save. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditFormData(currentData);
    setIsEditing(false);
  };

  const handleChange = (field: 'title' | 'logline', value: string) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleListChange = (field: 'genres' | 'tags', values: string[]) => {
    setEditFormData((prev) => ({ ...prev, [field]: values }));
  };

  const handleEdit = () => {
    if (!languageState.canEdit) {
      setShowTranslationModal(true);
      return;
    }
    setEditFormData(currentData);
    setIsEditing(true);
  };

  // Called after modal restores a version - just refresh the object
  const handleRestoreVersion = async () => {
    if (!basicInfoId) return;
    try {
      await fetchObject('basic_info', basicInfoId, globalDisplayLanguage);
    } catch (err) {
      console.error('Failed to refresh after restore:', err);
    }
  };

  // Get cover image from asset store using the cover_image_id
  const { fetchObjectAssetLinks, getMainAsset } = useAssetStore();
  const coverAsset = (projectId && basicInfoId) ? getMainAsset(projectId, 'basic_info', basicInfoId) : null;
  const coverImageUrl = getAssetUrl(coverAsset);

  // Fetch assets when basicInfoId is available
  useEffect(() => {
    if (projectId && basicInfoId) {
      fetchObjectAssetLinks(projectId, 'basic_info', basicInfoId);
    }
  }, [projectId, basicInfoId, fetchObjectAssetLinks]);

  if (!projectId) return <div className="error-container">Project ID not found.</div>;
  if (loading && !basicInfo) return <div className="loading-container"><Loading size="lg" /></div>;
  if (error) return <div className="error-container"><p>{error}</p><button onClick={() => basicInfoId && fetchObject('basic_info', basicInfoId, globalDisplayLanguage)}>Retry</button></div>;
  if (initializationError && !basicInfo) return <div className="error-container"><p>{initializationError}</p><button onClick={initializeBasicInfo} disabled={initializing}>Retry</button></div>;
  if (initializing && !basicInfo) return <div className="loading-container"><Loading size="lg" /></div>;
  if (!basicInfo) return <div className="error-container">Basic information not found.</div>;

  return (
    <div className="basic-info-manager">
      <div className="section-header">
        <h2>Basic Information</h2>
        {!isEditing ? (
          <div className="header-buttons">
            {showAIEdit && (
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
            )}
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
            {canRetranslate && (
                <TextButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTranslationModal(true)}
                  disabled={loading}
                  iconLeft={<Refresh size="xs" />}
                  className="desktop-only"
                >
                  Retranslate
                </TextButton>
            )}
            <TextButton
              variant="secondary"
              size="sm"
              onClick={canTranslate ? () => setShowTranslationModal(true) : handleEdit}
              disabled={loading}
              className="desktop-only"
            >
              {canTranslate ? 'Translate' : 'Edit'}
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
                label={canTranslate ? 'Translate' : 'Edit'}
                onClick={canTranslate ? () => setShowTranslationModal(true) : handleEdit}
                disabled={loading}
              />
              {showAIEdit && (
                <DropdownItem
                  icon={<AIAssist size="sm" />}
                  label="AI Edit"
                  onClick={() => setShowAIModal(true)}
                  disabled={loading}
                />
              )}
              {canRetranslate && (
                  <DropdownItem
                    icon={<Refresh size="sm" />}
                    label="Retranslate"
                    onClick={() => setShowTranslationModal(true)}
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
              <AuthenticatedImage src={coverImageUrl || ''} alt="Book Cover" className="book-cover-img" />
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
                  <StringChipInput
                    values={editFormData.genres}
                    onChange={(values) => handleListChange('genres', values)}
                    placeholder="Add genres"
                    ariaLabel="Genres"
                  />
                ) : (
                  currentData.genres.length > 0 ? (
                    currentData.genres.map((genreValue) => (
                      <span key={genreValue} className="genre-badge">{genreValue}</span>
                    ))
                  ) : (
                    <span className="genre-badge">Uncategorized</span>
                  )
                )}
                {languageState.isFallbackView && (
                  <span className="language-badge warning" title={`Showing ${languageState.viewLanguage}`}>
                    <Warning size="xs" /> {languageState.viewLanguage}
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
            <div className="basic-info-meta-section">
              <label className="section-label">Tags</label>
              {isEditing ? (
                <StringChipInput
                  values={editFormData.tags}
                  onChange={(values) => handleListChange('tags', values)}
                  placeholder="Add tags"
                  ariaLabel="Tags"
                />
              ) : currentData.tags.length > 0 ? (
                <div className="tag-badge-group">
                  {currentData.tags.map((tagValue) => (
                    <span key={tagValue} className="tag-badge">{tagValue}</span>
                  ))}
                </div>
              ) : (
                <p className="placeholder-text">No tags added yet.</p>
              )}
            </div>
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
                  disabled={isSaving || !languageState.canEdit}
                  iconLeft={<Save size="sm" />}
                >
                  {languageState.isTranslationView ? 'Save Translation Changes' : 'Save Changes'}
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
          isOpen={showTranslationModal}
          onClose={() => setShowTranslationModal(false)}
          projectId={projectId}
          preSelectedObjectIds={[basicInfoId]}
          defaultSourceLanguage={resolveTranslationSourceLanguage(basicInfo.language_state.available_languages, settings.mainLanguage)}
          defaultTargetLanguage={languageState.requestedLanguage}
        />
      )}

      {basicInfoId && (
        <UnifiedImageModal
          preset="objectManager"
          isOpen={showAssetPicker}
          onClose={() => setShowAssetPicker(false)}
          objectType="basic_info"
          objectId={basicInfoId}
          onAssetChange={() => fetchObject('basic_info', basicInfoId, globalDisplayLanguage)}
          title="Manage Cover Image"
        />
      )}
    </div>
  );
};

export default BasicInfoManager;

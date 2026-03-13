/**
 * GuidelinesManager - Project Guidelines Editor
 *
 * Manages project-level guidelines (authorNote) that are passed to AI prompts.
 * Uses global display language from parent (StoryObjectPanel).
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import './GuidelinesManager.css';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettings } from '../../store/settingsStore';
import { alert as showAlert } from '../../store/dialogStore';
import AIEditModal from '../Modal/AIEditModal';
import VersionHistoryModal from '../Modal/VersionHistoryModal';
import TranslationModal from '../Modal/TranslationModal';
import { DropdownMenu, DropdownItem } from '../ui/DropdownMenu';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import { Edit, Refresh, Books, AIAssist, Warning, MoreHorizontal, Save, Close } from '../icons';
import { Loading } from '../common/Loading';
import type { GuidelinesObject, GuidelinesData } from '../../types/unifiedObject';

interface GuidelinesManagerProps {
  globalDisplayLanguage: string;
}

const GuidelinesManager: React.FC<GuidelinesManagerProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const objects = useUnifiedObjectStore((state) => state.objects);
  const loadingMap = useUnifiedObjectStore((state) => state.loading);
  const errors = useUnifiedObjectStore((state) => state.errors);
  const fetchObject = useUnifiedObjectStore((state) => state.fetchObject);
  const updateObject = useUnifiedObjectStore((state) => state.updateObject);
  const listObjects = useUnifiedObjectStore((state) => state.listObjects);
  const settings = useSettings();
  // Get guidelines from unified store
  const [guidelinesId, setGuidelinesId] = useState<string | null>(null);
  const guidelines = guidelinesId ? (objects[guidelinesId] as GuidelinesObject) : null;
  const loading = guidelinesId ? (loadingMap[guidelinesId] || false) : false;
  const error = guidelinesId ? (errors[guidelinesId] || null) : null;
  const [initializing, setInitializing] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const [editFormData, setEditFormData] = useState<GuidelinesData>({
    authorNote: '',
  });

  // Modal state
  const [showAIModal, setShowAIModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Helper to get data for a specific language
  const getDataForLanguage = useCallback((lang: string): GuidelinesData => {
    if (!guidelines) return { authorNote: '' };
    const data = guidelines.data[lang];
    if (data) return data as GuidelinesData;
    const availableLanguages = Object.keys(guidelines.data);
    if (availableLanguages.length > 0) {
      return guidelines.data[availableLanguages[0]] as GuidelinesData;
    }
    return { authorNote: '' };
  }, [guidelines]);

  // Compute effective display language with fallback
  const { effectiveLanguage, isFallback } = useMemo(() => {
    if (!guidelines) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    const available = Object.keys(guidelines.data);
    if (available.includes(globalDisplayLanguage)) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    return { effectiveLanguage: available[0] || globalDisplayLanguage, isFallback: true };
  }, [guidelines, globalDisplayLanguage]);

  const currentData = useMemo(() => getDataForLanguage(effectiveLanguage), [getDataForLanguage, effectiveLanguage]);

  const initializeGuidelines = useCallback(async () => {
    if (!projectId) {
      setGuidelinesId(null);
      return;
    }

    setInitializing(true);
    setInitializationError(null);

    try {
      const existing = await listObjects('guidelines', projectId);
      if (existing.length > 0) {
        setGuidelinesId(existing[0].id);
      } else {
        // Guidelines should be auto-created with the project
        setInitializationError('Guidelines not found. This should not happen.');
      }
    } catch (err) {
      console.error('Failed to initialize guidelines:', err);
      setInitializationError(
        err instanceof Error ? err.message : 'Failed to load guidelines'
      );
    } finally {
      setInitializing(false);
    }
  }, [projectId, listObjects]);

  useEffect(() => {
    setGuidelinesId(null);
    initializeGuidelines();
  }, [initializeGuidelines]);

  useEffect(() => {
    if (guidelinesId) {
      fetchObject('guidelines', guidelinesId);
    }
  }, [guidelinesId, fetchObject]);

  useEffect(() => {
    if (currentData && !isEditing) {
      setEditFormData(currentData);
    }
  }, [currentData, isEditing]);

  const handleSave = async () => {
    if (!guidelines || !guidelinesId) return;

    setIsSaving(true);
    try {
      await updateObject('guidelines', guidelinesId, {
        data: editFormData,
        language: effectiveLanguage,
        user_request: 'User Edit',
        create_new_version: true,
      });

      setIsEditing(false);
    } catch (err) {
      console.error('Failed to save guidelines:', err);
      showAlert({ title: 'Save Error', message: 'Failed to save. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditFormData(currentData);
    setIsEditing(false);
  };

  const handleChange = (value: string) => {
    setEditFormData({ authorNote: value });
  };

  const handleEdit = () => {
    setEditFormData(currentData);
    setIsEditing(true);
  };

  // Called after modal restores a version - just refresh the object
  const handleRestoreVersion = async () => {
    if (!guidelinesId) return;
    try {
      await fetchObject('guidelines', guidelinesId);
    } catch (err) {
      console.error('Failed to refresh after restore:', err);
    }
  };

  if (!projectId) return <div className="error-container">Project ID not found.</div>;
  if (loading && !guidelines) return <div className="loading-container"><Loading size="lg" /></div>;
  if (error) return <div className="error-container"><p>{error}</p><button onClick={() => guidelinesId && fetchObject('guidelines', guidelinesId)}>Retry</button></div>;
  if (initializationError && !guidelines) return <div className="error-container"><p>{initializationError}</p><button onClick={initializeGuidelines} disabled={initializing}>Retry</button></div>;
  if (initializing && !guidelines) return <div className="loading-container"><Loading size="lg" /></div>;
  if (!guidelines) return <div className="error-container">Guidelines not found.</div>;

  return (
    <div className="guidelines-manager">
      <div className="section-header">
        <h2>Guidelines</h2>
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
            {settings.defaultSubLanguage &&
              Object.keys(guidelines.data).includes(settings.defaultSubLanguage) && (
                <TextButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRetranslateModal(true)}
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
                Object.keys(guidelines.data).includes(settings.defaultSubLanguage) && (
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
            {/* Actions are in the card footer */}
          </div>
        )}
      </div>
      <div className="section-divider" />

      <div className="guidelines-layout">
        <div className={`guidelines-card ${isEditing ? 'is-editing' : ''}`}>

          <div className="guidelines-content">
            <header className="content-header">
              <div className="title-row">
                <h1 className="title-display">Author Note</h1>
                {isFallback && (
                  <span className="language-badge warning" title={`Showing ${effectiveLanguage}`}>
                    <Warning size="xs" /> {effectiveLanguage}
                  </span>
                )}
              </div>
              <p className="guidelines-description">
                Provide instructions, notes, or context for the AI. This will be included in all prompts via <code>{"{{ project.guidelines.authorNote }}"}</code>.
              </p>
            </header>

            <div className="content-body">
              {isEditing ? (
                <textarea
                  className="author-note-input"
                  value={editFormData.authorNote}
                  onChange={(e) => handleChange(e.target.value)}
                  placeholder="Enter author notes, writing style preferences, world-building rules, or any instructions for the AI..."
                  rows={12}
                  autoFocus
                />
              ) : (
                <div className="author-note-display">
                  {currentData.authorNote ? (
                    <pre className="author-note-text">{currentData.authorNote}</pre>
                  ) : (
                    <p className="placeholder-text">
                      No author note provided. Click Edit to add instructions or context for the AI.
                    </p>
                  )}
                </div>
              )}
            </div>

            <footer className="content-footer">
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
                  <span>v{guidelines.version.number}</span>
                  <span className="separator">|</span>
                  <span>Last updated {new Date(guidelines.metadata.updated_at || Date.now()).toLocaleDateString()}</span>
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
        category="guidelines"
        projectId={projectId}
        targetId={guidelinesId ?? undefined}
      />

      {guidelinesId && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          objectType="guidelines"
          objectId={guidelinesId!}
          onRestoreVersion={handleRestoreVersion}
        />
      )}

      {guidelines && guidelinesId && projectId && (
        <TranslationModal
          isOpen={showRetranslateModal}
          onClose={() => setShowRetranslateModal(false)}
          projectId={projectId}
          preSelectedObjectIds={[guidelinesId]}
          defaultSourceLanguage={settings.mainLanguage}
          defaultTargetLanguage={settings.defaultSubLanguage}
        />
      )}
    </div>
  );
};

export default GuidelinesManager;

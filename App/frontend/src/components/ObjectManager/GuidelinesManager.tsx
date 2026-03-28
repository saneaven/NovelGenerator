/**
 * GuidelinesManager - Project Guidelines Editor
 *
 * Manages project-level guidelines (authorNote) that are passed to AI prompts.
 * Uses global display language from parent (StoryEntityPanel).
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
import { RichTextEditor } from '../RichTextEditor';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { Edit, Refresh, Books, AIAssist, Warning, MoreHorizontal, Save, Close } from '../icons';
import { Loading } from '../common/Loading';
import type { TipTapDoc } from '../../types/tiptap';
import { emptyDoc, normalizeDoc } from '../../editor/manuscript/doc';
import type { GuidelinesObject, GuidelinesData } from '../../types/unifiedObject';
import {
  resolveRequestedLanguageState,
  resolveTranslationSourceLanguage,
} from '../../utils/requestedLanguage';

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
  const getRichTextMarkdown = useUnifiedObjectStore((state) => state.getRichTextMarkdown);
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
    authorNote: emptyDoc(),
  });

  // Modal state
  const [showAIModal, setShowAIModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Helper to get data for a specific language
  const getDataForLanguage = useCallback((lang: string): GuidelinesData => {
    if (!guidelines) return { authorNote: emptyDoc() };
    const data = guidelines.data[lang];
    if (data) return { authorNote: normalizeDoc((data as GuidelinesData).authorNote) };
    const availableLanguages = Object.keys(guidelines.data);
    if (availableLanguages.length > 0) {
      const fallback = guidelines.data[availableLanguages[0]] as GuidelinesData;
      return { authorNote: normalizeDoc(fallback.authorNote) };
    }
    return { authorNote: emptyDoc() };
  }, [guidelines]);

  const languageState = useMemo(
    () => resolveRequestedLanguageState({
      availableLanguages: guidelines ? Object.keys(guidelines.data) : [],
      requestedLanguage: globalDisplayLanguage,
      mainLanguage: settings.mainLanguage,
    }),
    [guidelines, globalDisplayLanguage, settings.mainLanguage],
  );

  const currentData = useMemo(
    () => getDataForLanguage(languageState.viewLanguage),
    [getDataForLanguage, languageState.viewLanguage],
  );
  const currentAuthorNoteMarkdown = useMemo(
    () => (
      guidelinesId
        ? getRichTextMarkdown(guidelinesId, languageState.viewLanguage, 'authorNote')
        : undefined
    ),
    [getRichTextMarkdown, guidelinesId, languageState.viewLanguage],
  );

  const canTranslate = languageState.isTranslationView && !languageState.hasRequestedLanguage;
  const canRetranslate = languageState.isTranslationView && languageState.hasRequestedLanguage;
  const showAIEdit = languageState.isMainLanguage;

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

  useEffect(() => {
    if (isEditing && !languageState.canEdit) {
      setIsEditing(false);
    }
  }, [isEditing, languageState.canEdit]);

  const handleSave = async () => {
    if (!guidelines || !guidelinesId || !languageState.canEdit) return;

    setIsSaving(true);
    try {
      await updateObject('guidelines', guidelinesId, {
        data: editFormData,
        language: languageState.requestedLanguage,
        user_request: 'User Edit',
        create_new_version: languageState.createNewVersion,
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

  const handleChange = (value: TipTapDoc) => {
    setEditFormData({ authorNote: value });
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
                {languageState.isFallbackView && (
                  <span className="language-badge warning" title={`Showing ${languageState.viewLanguage}`}>
                    <Warning size="xs" /> {languageState.viewLanguage}
                  </span>
                )}
              </div>
              <p className="guidelines-description">
                Provide instructions, notes, or context for the AI. This will be included in all prompts via <code>{"{{ project.guidelines.authorNote }}"}</code>.
              </p>
            </header>

            <div className="content-body">
              {isEditing ? (
                <RichTextEditor
                  initialContent={normalizeDoc(editFormData.authorNote)}
                  onChange={handleChange}
                  placeholder="Enter author notes, writing style preferences, world-building rules, or any instructions for the AI..."
                />
              ) : (
                <div className="author-note-display">
                  {currentAuthorNoteMarkdown?.trim() ? (
                    <MarkdownRenderer className="markdown-content author-note-markdown">
                      {currentAuthorNoteMarkdown}
                    </MarkdownRenderer>
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
                  disabled={isSaving || !languageState.canEdit}
                  iconLeft={<Save size="sm" />}
                >
                    {languageState.isTranslationView ? 'Save Translation Changes' : 'Save Changes'}
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
          isOpen={showTranslationModal}
          onClose={() => setShowTranslationModal(false)}
          projectId={projectId}
          preSelectedObjectIds={[guidelinesId]}
          defaultSourceLanguage={resolveTranslationSourceLanguage(Object.keys(guidelines.data), settings.mainLanguage)}
          defaultTargetLanguage={languageState.requestedLanguage}
        />
      )}
    </div>
  );
};

export default GuidelinesManager;

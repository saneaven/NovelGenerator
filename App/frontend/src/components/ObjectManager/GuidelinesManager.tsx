/**
 * GuidelinesManager - Project Guidelines Editor
 *
 * Manages project-level guidelines (authorNote) that are passed to AI prompts.
 * Uses global display language from parent (StoryEntityPanel).
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import './GuidelinesManager.css';
import { useObjectCollectionQuery } from '../../data/objects/useObjectCollectionQuery';
import { useUpdateObjectMutation } from '../../data/objects/mutations/useUpdateObjectMutation';
import { useSettings } from '../../data/settings';
import { alert as showAlert } from '../../store/dialogStore';
import AIEditModal from '../Modal/AIEditModal';
import VersionHistoryModal from '../Modal/VersionHistoryModal';
import TranslationModal from '../Modal/TranslationModal';
import { DropdownMenu, DropdownItem } from '../ui/DropdownMenu';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import { RichTextEditor, type RichTextEditorRef } from '../RichTextEditor';
import { useContentReloadKey } from '../RichTextEditor/useContentReloadKey';
import { MarkdownRenderer } from '../MarkdownRenderer';
import { Edit, Refresh, Books, AIAssist, Warning, MoreHorizontal, Save, Close } from '../icons';
import { Skeleton, SkeletonText } from '../common/Skeleton';
import { emptyDoc, normalizeDoc } from '../../editor/richtext/doc';
import type { GuidelinesObject, GuidelinesData } from '../../types/unifiedObject';
import {
  requestedLanguageStateFromProjection,
  resolveTranslationSourceLanguage,
} from '../../utils/requestedLanguage';

interface GuidelinesManagerProps {
  globalDisplayLanguage: string;
}

const GuidelinesManager: React.FC<GuidelinesManagerProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const settings = useSettings();
  const updateMutation = useUpdateObjectMutation();

  // Get guidelines from the project's guidelines collection (exactly one per project).
  // Primary query fetches the TipTap doc (default format) used for editing/saving;
  // a sibling markdown query supplies the rendered preview (replaces getRichTextMarkdown).
  const guidelinesQuery = useObjectCollectionQuery(projectId, 'guidelines', globalDisplayLanguage);
  const guidelinesMarkdownQuery = useObjectCollectionQuery(projectId, 'guidelines', globalDisplayLanguage, 'markdown');
  const guidelines = (guidelinesQuery.data?.[0] as GuidelinesObject | undefined) ?? null;
  const guidelinesId = guidelines?.id ?? null;
  const loading = guidelinesQuery.isLoading;
  const error = guidelinesQuery.error
    ? (guidelinesQuery.error instanceof Error ? guidelinesQuery.error.message : 'Failed to load guidelines')
    : null;
  // Guidelines are auto-created with the project; an empty collection means it is missing.
  const notFound = !guidelinesQuery.isLoading && !guidelinesQuery.error && !guidelines
    ? 'Guidelines not found. This should not happen.'
    : null;

  // Edit state
  const [isEditing, setIsEditing] = useState(false);
  const editorRef = useRef<RichTextEditorRef>(null);

  // Modal state
  const [showAIModal, setShowAIModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Helper to get data for a specific language
  const getDataForLanguage = useCallback((lang: string): GuidelinesData => {
    void lang;
    if (!guidelines) return { authorNote: emptyDoc() };
    return { authorNote: normalizeDoc((guidelines.data as GuidelinesData).authorNote) };
  }, [guidelines]);

  const languageState = useMemo(
    () => requestedLanguageStateFromProjection(guidelines?.language_state, settings.mainLanguage),
    [guidelines, globalDisplayLanguage, settings.mainLanguage],
  );

  const currentData = useMemo(
    () => getDataForLanguage(languageState.viewLanguage),
    [getDataForLanguage, languageState.viewLanguage],
  );
  const currentAuthorNoteMarkdown = useMemo(() => {
    // Markdown-format query: data.authorNote is already rendered markdown text.
    const data = guidelinesMarkdownQuery.data?.[0]?.data as Record<string, unknown> | undefined;
    const md = data?.authorNote;
    return typeof md === 'string' ? md : undefined;
  }, [guidelinesMarkdownQuery.data]);

  const canTranslate = languageState.isTranslationView && !languageState.hasRequestedLanguage;
  const canRetranslate = languageState.isTranslationView && languageState.hasRequestedLanguage;
  const showAIEdit = languageState.isMainLanguage;

  const { reloadKey } = useContentReloadKey(
    `guidelines:${guidelinesId ?? ''}:${languageState.viewLanguage}`,
    guidelines?.version?.number ?? null,
  );

  useEffect(() => {
    if (isEditing && !languageState.canEdit) {
      setIsEditing(false);
    }
  }, [isEditing, languageState.canEdit]);

  const handleSave = async () => {
    if (!guidelines || !guidelinesId || !languageState.canEdit) return;

    setIsSaving(true);
    try {
      await updateMutation.mutateAsync({
        type: 'guidelines',
        id: guidelinesId,
        request: {
          data: { authorNote: normalizeDoc(editorRef.current?.getDoc() ?? currentData.authorNote) },
          language: languageState.requestedLanguage,
          user_request: 'User Edit',
          create_new_version: languageState.createNewVersion,
        },
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
    setIsEditing(false);
  };

  const handleEdit = () => {
    if (!languageState.canEdit) {
      setShowTranslationModal(true);
      return;
    }
    setIsEditing(true);
  };

  // Called after modal restores a version - just refresh the object
  const handleRestoreVersion = async () => {
    if (!guidelinesId) return;
    try {
      await Promise.all([guidelinesQuery.refetch(), guidelinesMarkdownQuery.refetch()]);
    } catch (err) {
      console.error('Failed to refresh after restore:', err);
    }
  };

  // A stale projection (still showing the previous language) counts as "not ready"
  // while a fetch for the requested language is in flight, so we keep showing the
  // skeleton on a language switch instead of flashing stale content.
  const isStaleLanguage = guidelines
    ? guidelines.language_state?.requested_language !== globalDisplayLanguage
    : false;
  const loadingView = (
    <div className="guidelines-manager">
      <div className="section-header"><h2>Guidelines</h2></div>
      <div className="section-divider" />
      <div className="guidelines-layout">
        <div className="guidelines-card">
          <div className="guidelines-content" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
            <Skeleton width="35%" height={20} />
            <SkeletonText lines={8} />
          </div>
        </div>
      </div>
    </div>
  );

  if (!projectId) return <div className="error-container">Project ID not found.</div>;
  if (loading && (!guidelines || isStaleLanguage)) return loadingView;
  if (error) return <div className="error-container"><p>{error}</p><button onClick={() => guidelinesQuery.refetch()}>Retry</button></div>;
  if (notFound && !guidelines) return <div className="error-container"><p>{notFound}</p><button onClick={() => guidelinesQuery.refetch()} disabled={loading}>Retry</button></div>;
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
                  ref={editorRef}
                  key={reloadKey}
                  initialContent={normalizeDoc(currentData.authorNote)}
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
          defaultSourceLanguage={resolveTranslationSourceLanguage(guidelines.language_state.available_languages, settings.mainLanguage)}
          defaultTargetLanguage={languageState.requestedLanguage}
        />
      )}
    </div>
  );
};

export default GuidelinesManager;

/**
 * NovelEditorPanel - Novel Writing Interface
 *
 * Complete redesign with the following features:
 * 
 * Core Features:
 * - Rich text editor for chapter content
 * - Auto-save with debouncing (2s delay, in-place updates)
 * - Manual save creates version snapshots
 * - Word count tracking
 * - Save status indicators
 * 
 * AI Features:
 * - AI Edit modal for content improvement
 * - Chat integration for AI assistance
 * - Function calling for AI-generated content
 * 
 * Translation Features:
 * - Multi-language support
 * - Language switcher
 * - AI translation
 * 
 * Version Management:
 * - Automatic snapshots every 5 minutes (if changes exist)
 * - Manual version creation
 * - Version history sidebar
 * - Version restoration
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { useNovelEditorStore } from '../../../store/novelEditorStore';
import NovelChapterAIEditModal from '../../../components/NovelChapterAIEditModal';
import RetranslateModal from '../../../components/RetranslateModal';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { TranslationService } from '../../../services/translationService';
import type { ManuscriptObject } from '../../../types/unifiedObject';
import ChapterSidebar from './ChapterSidebar';

interface NovelEditorPanelProps {
  projectId: string;
  selectedChapter: {
    id: string;
    name: string;
    description: string;
    order: number;
    actId: string;
  } | null;
  selectedChapterId: string | null;
  hasChapters: boolean;
  chaptersInitialized: boolean;
  onSelectChapter: (chapterId: string) => void;
}

// Constants
const AUTO_SAVE_DELAY = 2000; // 2 seconds
const SNAPSHOT_INTERVAL = 5 * 60 * 1000; // 5 minutes

const NovelEditorPanel: React.FC<NovelEditorPanelProps> = ({
  projectId,
  selectedChapter,
  selectedChapterId,
  hasChapters,
  chaptersInitialized,
  onSelectChapter,
}) => {
  const store = useUnifiedObjectStore();
  const translating = useUnifiedObjectStore((state) => state.translating);
  const { settings } = useSettingsStore();
  const { showError, showSuccess } = useErrorStore();
  const editorStore = useNovelEditorStore();

  // Get UI state from store
  const isChapterSidebarVisible = editorStore.isChapterSidebarVisible(projectId);
  const globalDisplayLanguage = editorStore.getDisplayLanguage(projectId) || settings.mainLanguage;

  // State
  const [manuscriptId, setManuscriptId] = useState<string | null>(null);
  const [isResolvingContentId, setIsResolvingContentId] = useState(false);
  const [contentIdError, setContentIdError] = useState<string | null>(null);
  const [isAIEditModalOpen, setIsAIEditModalOpen] = useState(false);
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isToolbarExpanded, setIsToolbarExpanded] = useState(true);

  // Editor state
  const [content, setContent] = useState('');
  const [lastSavedContent, setLastSavedContent] = useState('');
  const [lastSnapshotTime, setLastSnapshotTime] = useState(Date.now());
  const [isSaving, setIsSaving] = useState(false);
  const [savingType, setSavingType] = useState<'auto' | 'manual' | null>(null);

  // Refs
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const snapshotIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isUserEditingRef = useRef(false);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Get manuscript from store
  const manuscript = manuscriptId
    ? (store.objects[manuscriptId] as ManuscriptObject)
    : null;
  const loading = manuscriptId ? (store.loading[manuscriptId] || false) : false;
  const error = manuscriptId ? (store.errors[manuscriptId] || null) : null;

  // Computed: Check if current language translation is missing
  const isMissingTranslation = useMemo(() => {
    if (!manuscript) return false;
    return !manuscript.languages.available.includes(globalDisplayLanguage);
  }, [manuscript, globalDisplayLanguage]);

  // Computed: Available source languages for translation
  const availableSourceLanguages = useMemo(() => {
    if (!manuscript) return [];
    return manuscript.languages.available;
  }, [manuscript]);

  // Compute effective display language with fallback
  // globalDisplayLanguage is now the actual language string (e.g., 'English', 'Korean')
  const { effectiveLanguage, isFallback } = useMemo(() => {
    if (!manuscript) {
      return { effectiveLanguage: globalDisplayLanguage || settings.mainLanguage, isFallback: false };
    }
    const available = manuscript.languages.available;
    if (available.includes(globalDisplayLanguage)) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    // Fallback to first available or mainLanguage
    return { effectiveLanguage: available[0] || settings.mainLanguage, isFallback: true };
  }, [manuscript, globalDisplayLanguage, settings.mainLanguage]);

  // Debug logging
  useEffect(() => {
    if (manuscriptId) {
      console.log('📊 Store state for manuscript:', {
        manuscriptId,
        hasObject: !!manuscript,
        loading,
        error,
        objectType: manuscript?.type,
        objectKeys: manuscript ? Object.keys(manuscript) : [],
      });
    }
  }, [manuscriptId, manuscript, loading, error]);

  // Find existing manuscript
  const existingManuscript = useMemo(() => {
    if (!selectedChapterId) return null;
    const matchingObject = Object.values(store.objects).find(
      (obj) =>
        obj.type === 'manuscript' && obj.metadata?.chapter_id === selectedChapterId
    ) as ManuscriptObject | undefined;
    return matchingObject || null;
  }, [selectedChapterId, store.objects]);

  // Computed values
  const wordCount = useMemo(() => {
    return content.trim().split(/\s+/).filter(Boolean).length;
  }, [content]);

  const hasUnsavedChanges = content !== lastSavedContent;

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Resolve manuscript object ID when chapter selection changes
  useEffect(() => {
    let isActive = true;

    const resolveManuscriptId = async () => {
      if (!projectId || !selectedChapterId) {
        if (!isActive) return;
        console.log('⚠️ No projectId or selectedChapterId, clearing state');
        setManuscriptId(null);
        setContentIdError(null);
        setIsResolvingContentId(false);
        return;
      }

      if (existingManuscript) {
        if (!isActive) return;
        console.log('✅ Found existing manuscript in store:', existingManuscript.id);
        setManuscriptId(existingManuscript.id);
        setContentIdError(null);
        setIsResolvingContentId(false);
        return;
      }

      console.log('🔄 Resolving manuscript ID for chapter:', selectedChapterId);
      setIsResolvingContentId(true);
      setContentIdError(null);

      try {
        console.log('📡 Listing manuscript objects...');
        const manuscripts = await store.listObjects('manuscript', projectId);
        if (!isActive) return;

        console.log(`📋 Found ${manuscripts.length} manuscript objects`);
        const matchingManuscript = manuscripts.find(
          (m) => m.metadata?.chapter_id === selectedChapterId
        );

        if (matchingManuscript) {
          console.log('✅ Found matching manuscript:', matchingManuscript.id);
          setManuscriptId(matchingManuscript.id);
          return;
        }

        // Create new manuscript if it doesn't exist
        console.log('➕ Creating new manuscript...');
        const primaryLanguage = settings.mainLanguage || 'en';
        const createdManuscript = await store.createObject(
          'manuscript',
          projectId,
          {
            content: '',
            wordCount: 0,
          },
          primaryLanguage,
          { chapter_id: selectedChapterId }
        );

        if (!isActive) return;
        console.log('✅ Created new manuscript:', createdManuscript.id);
        setManuscriptId(createdManuscript.id);
      } catch (err) {
        console.error('❌ Failed to resolve manuscript ID:', err);
        if (!isActive) return;
        setManuscriptId(null);
        setContentIdError('Failed to load or create manuscript.');
      } finally {
        if (isActive) {
          setIsResolvingContentId(false);
        }
      }
    };

    resolveManuscriptId();

    return () => {
      isActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    selectedChapterId,
    existingManuscript,
    // store는 stable하므로 제거
    settings.mainLanguage,
  ]);

  // Fetch manuscript when ID available or language changes
  useEffect(() => {
    if (!manuscriptId) return;

    console.log('🔍 Fetching manuscript:', manuscriptId, 'language:', globalDisplayLanguage);

    // Set a timeout to prevent infinite loading
    loadingTimeoutRef.current = setTimeout(() => {
      if (!manuscript && loading) {
        console.error('⏱️ Loading timeout - forcing error state');
        setContentIdError('Loading timeout. The manuscript is taking too long to load. Please try refreshing.');
      }
    }, 10000); // 10 second timeout

    store.fetchObject('manuscript', manuscriptId, globalDisplayLanguage).catch(err => {
      console.error('❌ Failed to fetch manuscript:', err);
      const errorMessage = err.message || 'Unknown error';

      // Check if it's a "translation not found" error
      if (errorMessage.includes('Translation not found')) {
        // Fetch manuscript without language to get metadata (available languages)
        // isMissingTranslation will be computed automatically from manuscript.languages.available
        store.fetchObject('manuscript', manuscriptId).catch(() => {
          // If even that fails, show real error
          setContentIdError(errorMessage);
        });
      } else {
        setContentIdError(errorMessage);
      }
    });

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manuscriptId, globalDisplayLanguage]); // store는 stable하므로 dependency에서 제거

  // Load content when manuscript changes or language switches
  useEffect(() => {
    if (manuscript?.data && !isUserEditingRef.current) {
      setContent(manuscript.data.content);
      setLastSavedContent(manuscript.data.content);
    }
  }, [manuscript?.data]);

  // Setup periodic snapshot creation
  useEffect(() => {
    if (!manuscriptId) return;

    // Create snapshot every 5 minutes if there are changes
    snapshotIntervalRef.current = setInterval(() => {
      if (hasUnsavedChanges) {
        handleManualSave('Automatic Snapshot');
      }
    }, SNAPSHOT_INTERVAL);

    return () => {
      if (snapshotIntervalRef.current) {
        clearInterval(snapshotIntervalRef.current);
      }
    };
  }, [manuscriptId, hasUnsavedChanges]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      if (snapshotIntervalRef.current) {
        clearInterval(snapshotIntervalRef.current);
      }
    };
  }, []);

  // ============================================================================
  // SAVE HANDLERS
  // ============================================================================

  /**
   * Auto-save: Debounced, in-place update (no version created)
   * Called on every keystroke after debounce delay
   */
  const handleAutoSave = useCallback(async () => {
    if (!manuscript || !manuscriptId || !hasUnsavedChanges) return;

    setIsSaving(true);
    setSavingType('auto');

    try {
      await store.updateObject('manuscript', manuscriptId, {
        data: {
          content,
          wordCount,
        },
        language: effectiveLanguage,
        user_request: 'Auto-save',
        create_new_version: false, // IN-PLACE UPDATE - No version spam!
      });

      setLastSavedContent(content);
      isUserEditingRef.current = false;
      console.log('✓ Auto-saved (in-place)');
    } catch (err) {
      console.error('Auto-save failed:', err);
      // Don't show error for auto-save failures, just log
    } finally {
      setIsSaving(false);
      setSavingType(null);
    }
  }, [manuscript, manuscriptId, content, wordCount, hasUnsavedChanges, store, effectiveLanguage]);

  /**
   * Manual save: Creates version snapshot
   * Called when user clicks Save button
   */
  const handleManualSave = useCallback(
    async (reason: string = 'Manual Save') => {
      if (!manuscript || !manuscriptId) return;

      setIsSaving(true);
      setSavingType('manual');

      try {
        await store.updateObject('manuscript', manuscriptId, {
          data: {
            content,
            wordCount,
          },
          language: effectiveLanguage,
          user_request: reason,
          create_new_version: true, // CREATE VERSION SNAPSHOT
        });

        setLastSavedContent(content);
        setLastSnapshotTime(Date.now());
        isUserEditingRef.current = false;
        console.log('✓ Manual save (new version)');
      } catch (err) {
        console.error('Manual save failed:', err);
        showError('Save Error', 'Failed to save. Please try again.');
      } finally {
        setIsSaving(false);
        setSavingType(null);
      }
    },
    [manuscript, manuscriptId, content, wordCount, store, effectiveLanguage]
  );

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handleContentChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newContent = event.target.value;
      setContent(newContent);
      isUserEditingRef.current = true;

      // Clear existing auto-save timeout
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      // Schedule new auto-save
      autoSaveTimeoutRef.current = setTimeout(() => {
        handleAutoSave();
      }, AUTO_SAVE_DELAY);
    },
    [handleAutoSave]
  );

  const handleAIEditComplete = useCallback(() => {
    // Reload the manuscript after AI edit
    if (manuscriptId) {
      store.fetchObject('manuscript', manuscriptId);
    }
  }, [manuscriptId, store]);

  const handleRetranslate = useCallback(async (
    sourceLanguage: string,
    targetLanguage: string,
    includePrevious: boolean,
    userInstructions: string
  ) => {
    if (!manuscript || !manuscriptId) return;

    try {
      TranslationService.setTranslationStatus(manuscriptId, { objectId: manuscriptId, isTranslating: true });

      let instructions = userInstructions || '';
      if (includePrevious && manuscript.languages.available.includes(targetLanguage)) {
        const prevTranslation = `Previous translation for reference:\n${JSON.stringify({
          content: manuscript.data.content,
          wordCount: manuscript.data.wordCount,
        }, null, 2)}`;
        instructions = instructions ? `${instructions}\n\n${prevTranslation}` : prevTranslation;
      }

      await TranslationService.translateSingle(
        {
          objectType: 'manuscript',
          objectId: manuscriptId,
          sourceData: {
            content: manuscript.data.content,
            wordCount: manuscript.data.wordCount,
          },
        },
        {
          projectId,
          sourceLanguage,
          targetLanguage,
          userInstructions: instructions || undefined,
        }
      );

      // Reset editing ref before refetch so useEffect can update content
      // isMissingTranslation will be computed automatically after fetch
      isUserEditingRef.current = false;
      await store.fetchObject('manuscript', manuscriptId, globalDisplayLanguage);
      showSuccess('Success', `Retranslation complete for ${targetLanguage}`);
      setShowRetranslateModal(false);
    } catch (err) {
      console.error('Failed to retranslate:', err);
      showError('Retranslation Error', err instanceof Error ? err.message : 'Failed to retranslate. Please try again.');
    } finally {
      TranslationService.clearTranslationStatus(manuscriptId);
    }
  }, [manuscript, manuscriptId, projectId, store, globalDisplayLanguage, showError]);

  // Handle "Write from scratch" - create new translation with empty content
  const handleWriteFromScratch = useCallback(async () => {
    if (!manuscriptId) return;

    try {
      // Add the current language as a new translation with empty content
      await store.addTranslation('manuscript', manuscriptId, {
        language: globalDisplayLanguage,
        data: { content: '', wordCount: 0 }
      });

      // Re-fetch to get the new translation
      // isMissingTranslation will be computed automatically after fetch
      await store.fetchObject('manuscript', manuscriptId, globalDisplayLanguage);
    } catch (err) {
      console.error('Failed to create new translation:', err);
      showError('Error', 'Failed to create new content. Please try again.');
    }
  }, [manuscriptId, globalDisplayLanguage, store, showError]);

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!selectedChapterId) {
    const isChapterMissing = chaptersInitialized && !hasChapters;
    const heading = isChapterMissing
      ? 'No Chapters Available'
      : chaptersInitialized
        ? 'Loading chapter...'
        : 'Loading chapters...';
    const description = isChapterMissing
      ? 'Create chapters in the Workspace to start writing.'
      : chaptersInitialized
        ? 'Opening the first available chapter. Please wait.'
        : 'Loading your outline so we can open the first chapter.';

    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-state-content">
          <h2>{heading}</h2>
          <p>{description}</p>
        </div>
      </div>
    );
  }

  if (isResolvingContentId) {
    return (
      <div className="novel-editor-panel loading">
        <div className="spinner" />
        <p>Loading chapter content...</p>
      </div>
    );
  }

  if (contentIdError) {
    return (
      <div className="novel-editor-panel error">
        <h3>Chapter Content Error</h3>
        <p>{contentIdError}</p>
      </div>
    );
  }

  if (loading && !manuscript) {
    return (
      <div className="novel-editor-panel loading">
        <div className="spinner" />
        <p>Loading manuscript...</p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', marginTop: '0.5rem' }}>
          Manuscript ID: {manuscriptId}
        </p>
        <button
          className="toolbar-btn"
          style={{ marginTop: '1rem' }}
          onClick={() => {
            console.log('🔄 Manual retry - refetching manuscript');
            if (manuscriptId) {
              store.fetchObject('manuscript', manuscriptId);
            }
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="novel-editor-panel error">
        <h3>Error Loading Chapter</h3>
        <p>{error}</p>
        <button
          className="toolbar-btn"
          onClick={() => manuscriptId && store.fetchObject('manuscript', manuscriptId)}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!manuscript) {
    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-state-content">
          <h2>Manuscript Not Found</h2>
          <p>This chapter doesn't have manuscript content yet.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="novel-editor-panel">
        <div className="editor-main">
          {/* Chapter Header */}
          {selectedChapter && (
            <div className="editor-header">
              <div className="editor-info">
                <div className="editor-title-row">
                  <h2 className="editor-chapter-title">{selectedChapter.name}</h2>
                  {selectedChapter.description && (
                    <button
                      className="description-toggle-btn-inline mobile-only"
                      onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                      aria-expanded={isDescriptionExpanded}
                      title={isDescriptionExpanded ? 'Hide description' : 'Show description'}
                    >
                      {isDescriptionExpanded ? '▲' : '▼'}
                    </button>
                  )}
                </div>
                {selectedChapter.description && (
                  <div className={`editor-chapter-description-wrapper ${isDescriptionExpanded ? 'expanded' : ''}`}>
                    <p className="editor-chapter-description">{selectedChapter.description}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className={`editor-toolbar-wrapper ${isToolbarExpanded ? 'expanded' : 'collapsed'}`}>
            <div className="editor-toolbar">
              {/* Save Status */}
              <div className="save-status">
                {isSaving && savingType === 'auto' && <span className="saving-indicator">💾 Auto-saving...</span>}
                {isSaving && savingType === 'manual' && <span className="saving-indicator">💾 Saving...</span>}
                {!isSaving && hasUnsavedChanges && <span className="unsaved-indicator">● Unsaved changes</span>}
                {!isSaving && !hasUnsavedChanges && <span className="saved-indicator">✓ Saved</span>}
              </div>

              {/* Word Count */}
              <div className="stat-item">
                <span className="stat-value">{wordCount.toLocaleString()} words</span>
              </div>

              <div className="toolbar-info" />

              {/* Fallback Warning */}
              {isFallback && (
                <span className="fallback-warning" title={`${globalDisplayLanguage} not available, showing ${effectiveLanguage}`}>
                  ⚠️ {effectiveLanguage}
                </span>
              )}

              {/* AI Edit Button */}
              <button
                onClick={() => setIsAIEditModalOpen(true)}
                className="toolbar-btn ai-edit-btn"
                disabled={isSaving || !selectedChapter}
                title="AI Edit Chapter"
              >
                🤖 AI Edit
              </button>

              {/* Manual Save Button */}
              <button
                onClick={() => handleManualSave('Manual Save')}
                className="toolbar-btn save-btn"
                disabled={isSaving || !hasUnsavedChanges}
                title="Create version snapshot (Ctrl+S)"
              >
                💾 Save Snapshot
              </button>

              {/* More Actions Dropdown - show when there are sub languages */}
              {settings.subLanguages && settings.subLanguages.length > 0 && (
                <DropdownMenu
                  trigger={
                    <button className="more-button" disabled={isSaving} title="More actions">
                      •••
                    </button>
                  }
                >
                  {/* Show Translate if current display language doesn't exist, otherwise Retranslate */}
                  {manuscript?.languages.available.includes(globalDisplayLanguage) ? (
                    <DropdownItem
                      icon="🔄"
                      label="Retranslate"
                      onClick={() => setShowRetranslateModal(true)}
                      disabled={isSaving}
                    />
                  ) : (
                    <DropdownItem
                      icon="🌐"
                      label="Translate"
                      onClick={() => setShowRetranslateModal(true)}
                      disabled={isSaving || !manuscript}
                    />
                  )}
                </DropdownMenu>
              )}

              <div className="toolbar-separator" />
              <button
                onClick={() => editorStore.setChapterSidebarVisible(projectId, !isChapterSidebarVisible)}
                className="toolbar-btn sidebar-toggle-btn"
                title="Toggle chapter list"
              >
                ☰
              </button>
            </div>
            <button
              className="toolbar-collapse-btn mobile-only"
              onClick={() => setIsToolbarExpanded(!isToolbarExpanded)}
              aria-expanded={isToolbarExpanded}
            >
              {isToolbarExpanded ? '▲ Hide Toolbar' : '▼ Show Toolbar'}
            </button>
          </div>

          {/* Editor */}
          <div className={`editor-content ${isMissingTranslation ? 'disabled' : ''}`}>
            <textarea
              className="novel-textarea"
              value={isMissingTranslation ? '' : content}
              onChange={handleContentChange}
              placeholder="Start writing your chapter..."
              disabled={isSaving || isMissingTranslation}
            />
            {/* Missing Translation Overlay */}
            {isMissingTranslation && (
              <div className="missing-translation-overlay">
                <div className="overlay-content">
                  <h3>No content in {globalDisplayLanguage}</h3>
                  <p>This chapter doesn't have content in {globalDisplayLanguage} yet.</p>
                  <div className="overlay-actions">
                    {availableSourceLanguages.length > 0 && (
                      <button
                        className="primary-btn"
                        onClick={() => setShowRetranslateModal(true)}
                      >
                        Translate from {availableSourceLanguages[0]}
                      </button>
                    )}
                    <button
                      className="secondary-btn"
                      onClick={handleWriteFromScratch}
                    >
                      Write from scratch
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="editor-footer">
            <div className="editor-footer-info">
              <span>Language: {effectiveLanguage}</span>
              <span>•</span>
              <span>Version: {manuscript.version.number}</span>
              <span>•</span>
              <span>Last snapshot: {new Date(lastSnapshotTime).toLocaleTimeString()}</span>
            </div>
            <div className="editor-footer-notice">
              💡 Auto-saves every {AUTO_SAVE_DELAY / 1000}s | Snapshots every {SNAPSHOT_INTERVAL / 60000}m
            </div>
          </div>
        </div>

        {/* Chapter Sidebar */}
        <ChapterSidebar
          projectId={projectId}
          isVisible={isChapterSidebarVisible}
          onToggle={() => editorStore.setChapterSidebarVisible(projectId, !isChapterSidebarVisible)}
          selectedChapterId={selectedChapterId}
          onSelectChapter={onSelectChapter}
        />
      </div>

      {/* AI Edit Modal */}
      {selectedChapter && (
        <NovelChapterAIEditModal
          isOpen={isAIEditModalOpen}
          onClose={() => setIsAIEditModalOpen(false)}
          projectId={projectId}
          chapterId={selectedChapter.id}
          chapterName={selectedChapter.name}
          onResult={handleAIEditComplete}
        />
      )}

      {/* Retranslate Modal */}
      {manuscript && manuscriptId && (
        <RetranslateModal
          isOpen={showRetranslateModal}
          onClose={() => setShowRetranslateModal(false)}
          objectType="manuscript"
          objectId={manuscriptId}
          defaultSourceLanguage={
            isMissingTranslation && availableSourceLanguages.length > 0
              ? availableSourceLanguages[0]
              : manuscript.languages.available[0] || settings.mainLanguage
          }
          defaultTargetLanguage={globalDisplayLanguage}
          availableLanguages={[settings.mainLanguage, ...(settings.subLanguages || [])]}
          manuscriptLanguages={
            isMissingTranslation
              ? availableSourceLanguages
              : manuscript.languages.available
          }
          translationTimestamp={manuscript.version?.created_at || null}
          onRetranslate={handleRetranslate}
          isTranslating={translating[manuscriptId] || false}
        />
      )}
    </>
  );
};

export default NovelEditorPanel;

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
import { LanguageSwitcher } from '../../../components/LanguageSwitcher';
import NovelChapterAIEditModal from '../../../components/NovelChapterAIEditModal';
import { TranslationService } from '../../../services/translationService';
import type { ChapterContentObject } from '../../../types/unifiedObject';
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
  uiState: any;
  uiActions: any;
  onToggleSidebar: () => void;
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
  uiState,
  uiActions,
  onToggleSidebar,
  onSelectChapter,
}) => {
  const store = useUnifiedObjectStore();
  const { settings } = useSettingsStore();

  // State
  const [chapterContentId, setChapterContentId] = useState<string | null>(null);
  const [isResolvingContentId, setIsResolvingContentId] = useState(false);
  const [contentIdError, setContentIdError] = useState<string | null>(null);
  const [isAIEditModalOpen, setIsAIEditModalOpen] = useState(false);
  
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

  // Get chapter content from store
  const chapterContent = chapterContentId
    ? (store.objects[chapterContentId] as ChapterContentObject)
    : null;
  const loading = chapterContentId ? (store.loading[chapterContentId] || false) : false;
  const error = chapterContentId ? (store.errors[chapterContentId] || null) : null;

  // Debug logging
  useEffect(() => {
    if (chapterContentId) {
      console.log('📊 Store state for chapter content:', {
        chapterContentId,
        hasObject: !!chapterContent,
        loading,
        error,
        objectType: chapterContent?.type,
        objectKeys: chapterContent ? Object.keys(chapterContent) : [],
      });
    }
  }, [chapterContentId, chapterContent, loading, error]);

  // Find existing chapter content
  const existingChapterContent = useMemo(() => {
    if (!selectedChapterId) return null;
    const matchingObject = Object.values(store.objects).find(
      (obj) =>
        obj.type === 'chapter_content' && obj.metadata?.chapter_id === selectedChapterId
    ) as ChapterContentObject | undefined;
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

  // Resolve chapter content object ID when chapter selection changes
  useEffect(() => {
    let isActive = true;

    const resolveChapterContentId = async () => {
      if (!projectId || !selectedChapterId) {
        if (!isActive) return;
        console.log('⚠️ No projectId or selectedChapterId, clearing state');
        setChapterContentId(null);
        setContentIdError(null);
        setIsResolvingContentId(false);
        return;
      }

      if (existingChapterContent) {
        if (!isActive) return;
        console.log('✅ Found existing chapter content in store:', existingChapterContent.id);
        setChapterContentId(existingChapterContent.id);
        setContentIdError(null);
        setIsResolvingContentId(false);
        return;
      }

      console.log('🔄 Resolving chapter content ID for chapter:', selectedChapterId);
      setIsResolvingContentId(true);
      setContentIdError(null);

      try {
        console.log('📡 Listing chapter_content objects...');
        const chapterContents = await store.listObjects('chapter_content', projectId);
        if (!isActive) return;

        console.log(`📋 Found ${chapterContents.length} chapter_content objects`);
        const matchingContent = chapterContents.find(
          (content) => content.metadata?.chapter_id === selectedChapterId
        );

        if (matchingContent) {
          console.log('✅ Found matching chapter content:', matchingContent.id);
          setChapterContentId(matchingContent.id);
          return;
        }

        // Create new chapter content if it doesn't exist
        console.log('➕ Creating new chapter content...');
        const primaryLanguage = settings.primaryLanguage || 'en';
        const createdContent = await store.createObject(
          'chapter_content',
          projectId,
          {
            content: '',
            wordCount: 0,
          },
          primaryLanguage,
          { chapter_id: selectedChapterId }
        );

        if (!isActive) return;
        console.log('✅ Created new chapter content:', createdContent.id);
        setChapterContentId(createdContent.id);
      } catch (err) {
        console.error('❌ Failed to resolve chapter content ID:', err);
        if (!isActive) return;
        setChapterContentId(null);
        setContentIdError('Failed to load or create chapter content.');
      } finally {
        if (isActive) {
          setIsResolvingContentId(false);
        }
      }
    };

    resolveChapterContentId();

    return () => {
      isActive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projectId,
    selectedChapterId,
    existingChapterContent,
    // store는 stable하므로 제거
    settings.primaryLanguage,
  ]);

  // Fetch chapter content when ID available
  useEffect(() => {
    if (!chapterContentId) return;
    
    console.log('🔍 Fetching chapter content:', chapterContentId);
    
    // Set a timeout to prevent infinite loading
    loadingTimeoutRef.current = setTimeout(() => {
      if (!chapterContent && loading) {
        console.error('⏱️ Loading timeout - forcing error state');
        setContentIdError('Loading timeout. The chapter content is taking too long to load. Please try refreshing.');
      }
    }, 10000); // 10 second timeout

    store.fetchObject('chapter_content', chapterContentId).catch(err => {
      console.error('❌ Failed to fetch chapter content:', err);
      setContentIdError(`Failed to fetch chapter content: ${err.message || 'Unknown error'}`);
    });

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterContentId]); // store는 stable하므로 dependency에서 제거

  // Load content when chapter content changes or language switches
  useEffect(() => {
    if (chapterContent?.data && !isUserEditingRef.current) {
      setContent(chapterContent.data.content);
      setLastSavedContent(chapterContent.data.content);
    }
  }, [chapterContent?.data]);

  // Setup periodic snapshot creation
  useEffect(() => {
    if (!chapterContentId) return;

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
  }, [chapterContentId, hasUnsavedChanges]);

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
    if (!chapterContent || !chapterContentId || !hasUnsavedChanges) return;

    setIsSaving(true);
    setSavingType('auto');

    try {
      await store.updateObject('chapter_content', chapterContentId, {
        data: {
          content,
          wordCount,
        },
        language: chapterContent.languages.active,
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
  }, [chapterContent, chapterContentId, content, wordCount, hasUnsavedChanges, store]);

  /**
   * Manual save: Creates version snapshot
   * Called when user clicks Save button
   */
  const handleManualSave = useCallback(
    async (reason: string = 'Manual Save') => {
      if (!chapterContent || !chapterContentId) return;

      setIsSaving(true);
      setSavingType('manual');

      try {
        await store.updateObject('chapter_content', chapterContentId, {
          data: {
            content,
            wordCount,
          },
          language: chapterContent.languages.active,
          user_request: reason,
          create_new_version: true, // CREATE VERSION SNAPSHOT
        });

        setLastSavedContent(content);
        setLastSnapshotTime(Date.now());
        isUserEditingRef.current = false;
        console.log('✓ Manual save (new version)');
      } catch (err) {
        console.error('Manual save failed:', err);
        alert('Failed to save. Please try again.');
      } finally {
        setIsSaving(false);
        setSavingType(null);
      }
    },
    [chapterContent, chapterContentId, content, wordCount, store]
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

  const handleLanguageChange = useCallback(
    async (newLanguage: string) => {
      if (!chapterContent || !chapterContentId) return;

      // Save current changes before switching
      if (hasUnsavedChanges) {
        await handleAutoSave();
      }

      try {
        await store.switchLanguage('chapter_content', chapterContentId, newLanguage);
        console.log(`✓ Switched to ${newLanguage}`);
      } catch (err) {
        console.error('Failed to switch language:', err);
        alert('Failed to switch language. Please try again.');
      }
    },
    [chapterContent, chapterContentId, hasUnsavedChanges, handleAutoSave, store]
  );

  const handleAddTranslation = useCallback(async () => {
    if (!chapterContent || !chapterContentId) return;

    const targetLanguage = settings.secondaryLanguage;
    if (!targetLanguage) {
      alert('Please set a secondary language in settings first.');
      return;
    }

    if (chapterContent.languages.available.includes(targetLanguage)) {
      // Just switch to it if it already exists
      await handleLanguageChange(targetLanguage);
      return;
    }

    try {
      TranslationService.setTranslationStatus(chapterContentId, { objectId: chapterContentId, isTranslating: true });

      // Use AI translation via TranslationService
      await TranslationService.translateSingle(
        {
          objectType: 'chapterContent',
          objectId: chapterContentId,
          sourceData: {
            content,
            wordCount,
          },
        },
        {
          projectId,
          sourceLanguage: chapterContent.languages.active,
          targetLanguage,
        }
      );

      console.log(`✓ Added ${targetLanguage} translation`);
      alert(`Translation added for ${targetLanguage}`);

      // Reload and switch to the new translation
      await store.fetchObject('chapter_content', chapterContentId);
      await handleLanguageChange(targetLanguage);
    } catch (error) {
      console.error('Failed to add translation:', error);
      alert(error instanceof Error ? error.message : 'Failed to add translation. Please try again.');
    } finally {
      TranslationService.clearTranslationStatus(chapterContentId);
    }
  }, [chapterContent, chapterContentId, content, wordCount, settings.secondaryLanguage, projectId, selectedChapter, store, handleLanguageChange]);

  const handleAIEditComplete = useCallback(() => {
    // Reload the chapter content after AI edit
    if (chapterContentId) {
      store.fetchObject('chapter_content', chapterContentId);
    }
  }, [chapterContentId, store]);

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

  if (loading && !chapterContent) {
    return (
      <div className="novel-editor-panel loading">
        <div className="spinner" />
        <p>Loading chapter content...</p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', marginTop: '0.5rem' }}>
          Chapter Content ID: {chapterContentId}
        </p>
        <button
          className="toolbar-btn"
          style={{ marginTop: '1rem' }}
          onClick={() => {
            console.log('🔄 Manual retry - refetching chapter content');
            if (chapterContentId) {
              store.fetchObject('chapter_content', chapterContentId);
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
          onClick={() => chapterContentId && store.fetchObject('chapter_content', chapterContentId)}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!chapterContent) {
    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-state-content">
          <h2>Chapter Not Found</h2>
          <p>This chapter doesn't have content yet.</p>
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
                <h2 className="editor-chapter-title">{selectedChapter.name}</h2>
                {selectedChapter.description && (
                  <p className="editor-chapter-description">{selectedChapter.description}</p>
                )}
              </div>
            </div>
          )}

          {/* Toolbar */}
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

            {/* Language Switcher */}
            <LanguageSwitcher
              object={chapterContent}
              onLanguageChange={handleLanguageChange}
              disabled={isSaving}
              showLabel={false}
            />

            {/* Add Translation Button */}
            {settings.secondaryLanguage &&
              !chapterContent.languages.available.includes(settings.secondaryLanguage) && (
                <button
                  onClick={handleAddTranslation}
                  className="toolbar-btn translate-btn"
                  disabled={isSaving}
                  title={`Translate to ${settings.secondaryLanguage}`}
                >
                  🌐 Add {settings.secondaryLanguage}
                </button>
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
            <div className="toolbar-separator" />
            <button
              onClick={onToggleSidebar}
              className="toolbar-btn sidebar-toggle-btn"
              title="Toggle chapter list"
            >
              ☰
            </button>


          </div>

          {/* Editor */}
          <div className="editor-content">
            <textarea
              className="novel-textarea"
              value={content}
              onChange={handleContentChange}
              placeholder="Start writing your chapter..."
              disabled={isSaving}
            />
          </div>

          {/* Footer */}
          <div className="editor-footer">
            <div className="editor-footer-info">
              <span>Language: {chapterContent.languages.active}</span>
              <span>•</span>
              <span>Version: {chapterContent.version.number}</span>
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
          isVisible={uiState.isChapterSidebarVisible}
          onToggle={() => uiActions.setIsChapterSidebarVisible(!uiState.isChapterSidebarVisible)}
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
    </>
  );
};

export default NovelEditorPanel;

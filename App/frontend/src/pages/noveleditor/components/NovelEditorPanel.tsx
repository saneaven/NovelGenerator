/**
 * NovelEditorPanel - Migrated to New Unified Translation System
 *
 * Key Features:
 * - Auto-save with debouncing (in-place updates, no version spam)
 * - Manual save button (creates version snapshot)
 * - LanguageSwitcher component
 * - Direct data access from unified store
 * - Simplified state management
 *
 * Changes from old system:
 * - Uses useUnifiedObjectStore instead of novelStore
 * - Debounced auto-save: create_new_version = false
 * - Manual save: create_new_version = true
 * - No complex version logic
 * - Clean language switching
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { LanguageSwitcher } from '../../../components/LanguageSwitcher';
import type { ChapterContentObject, ChapterContentData } from '../../../types/unifiedObject';
import ChapterSidebar from './ChapterSidebar';

interface NovelEditorPanelProps {
  projectId: string;
  selectedChapterId: string | null;
  onToggleSidebar: () => void;
  onSelectChapter: (chapterId: string) => void;
}

// Debounce delay for auto-save (milliseconds)
const AUTO_SAVE_DELAY = 2000;

// Interval for creating version snapshots (5 minutes)
const SNAPSHOT_INTERVAL = 5 * 60 * 1000;

const NovelEditorPanel: React.FC<NovelEditorPanelProps> = ({
  projectId,
  selectedChapterId,
  onToggleSidebar,
  onSelectChapter,
}) => {
  const store = useUnifiedObjectStore();
  const { settings } = useSettingsStore();

  // Get chapter content ID (in real app, you'd get this from the chapter)
  const [chapterContentId, setChapterContentId] = useState<string | null>(null);

  // Get chapter content from store
  const chapterContent = chapterContentId
    ? (store.objects[chapterContentId] as ChapterContentObject)
    : null;
  const loading = chapterContentId ? (store.loading[chapterContentId] || false) : false;
  const error = chapterContentId ? (store.errors[chapterContentId] || null) : null;

  // Editor state
  const [content, setContent] = useState('');
  const [lastSavedContent, setLastSavedContent] = useState('');
  const [lastSnapshotTime, setLastSnapshotTime] = useState(Date.now());
  const [isSaving, setIsSaving] = useState(false);
  const [savingType, setSavingType] = useState<'auto' | 'manual' | null>(null);

  // Refs for auto-save
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const snapshotIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isUserEditingRef = useRef(false);

  // Computed values
  const wordCount = useMemo(() => {
    return content.trim().split(/\s+/).filter(Boolean).length;
  }, [content]);

  const hasUnsavedChanges = content !== lastSavedContent;

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Fetch chapter content ID when chapter selected
  useEffect(() => {
    if (selectedChapterId) {
      // TODO: Get chapter content ID from chapter
      // For now, using placeholder
      // const contentId = await api.getChapterContentId(selectedChapterId);
      // setChapterContentId(contentId);
    }
  }, [selectedChapterId]);

  // Fetch chapter content when ID available
  useEffect(() => {
    if (chapterContentId) {
      store.fetchObject('chapter_content', chapterContentId);
    }
  }, [chapterContentId]);

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
        handleManualSave('Periodic Snapshot');
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
      alert(`${targetLanguage} translation already exists.`);
      return;
    }

    try {
      // In real implementation, use AI translation here
      await store.addTranslation('chapter_content', chapterContentId, {
        language: targetLanguage,
        data: {
          content: `[${targetLanguage}] ${content}`,
          wordCount,
        },
        user_request: 'Translation',
      });

      console.log(`✓ Added ${targetLanguage} translation`);
      alert(`Translation added for ${targetLanguage}`);
    } catch (err) {
      console.error('Failed to add translation:', err);
      alert('Failed to add translation. Please try again.');
    }
  }, [chapterContent, chapterContentId, content, wordCount, settings.secondaryLanguage, store]);

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!selectedChapterId) {
    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-message">
          <h3>No Chapter Selected</h3>
          <p>Select a chapter from the sidebar to start editing.</p>
        </div>
      </div>
    );
  }

  if (loading && !chapterContent) {
    return (
      <div className="novel-editor-panel loading">
        <div className="spinner" />
        <p>Loading chapter content...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="novel-editor-panel error">
        <h3>Error Loading Chapter</h3>
        <p>{error}</p>
        <button onClick={() => chapterContentId && store.fetchObject('chapter_content', chapterContentId)}>
          Retry
        </button>
      </div>
    );
  }

  if (!chapterContent) {
    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-message">
          <h3>Chapter Not Found</h3>
          <p>This chapter doesn't have content yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="novel-editor-panel">
      {/* Toolbar */}
      <div className="editor-toolbar">
        <div className="toolbar-left">
          <button onClick={onToggleSidebar} className="toggle-sidebar-btn">
            ☰
          </button>
          <h3 className="chapter-title">Chapter Editor</h3>
        </div>

        <div className="toolbar-center">
          {/* Save Status */}
          <div className="save-status">
            {isSaving && savingType === 'auto' && <span className="saving">💾 Auto-saving...</span>}
            {isSaving && savingType === 'manual' && <span className="saving">💾 Saving...</span>}
            {!isSaving && hasUnsavedChanges && <span className="unsaved">● Unsaved changes</span>}
            {!isSaving && !hasUnsavedChanges && <span className="saved">✓ Saved</span>}
          </div>

          {/* Word Count */}
          <div className="word-count">
            <span>{wordCount.toLocaleString()} words</span>
          </div>
        </div>

        <div className="toolbar-right">
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
                className="btn-secondary"
                disabled={isSaving}
                title={`Translate to ${settings.secondaryLanguage}`}
              >
                🌐 Add {settings.secondaryLanguage}
              </button>
            )}

          {/* Manual Save Button */}
          <button
            onClick={() => handleManualSave('Manual Save')}
            className="btn-primary save-btn"
            disabled={isSaving || !hasUnsavedChanges}
            title="Create version snapshot"
          >
            💾 Save Snapshot
          </button>
        </div>
      </div>

      {/* Editor */}
      <div className="editor-container">
        <textarea
          className="chapter-editor"
          value={content}
          onChange={handleContentChange}
          placeholder="Start writing your chapter..."
          disabled={isSaving}
        />
      </div>

      {/* Footer */}
      <div className="editor-footer">
        <div className="footer-info">
          <span>Language: {chapterContent.languages.active}</span>
          <span>•</span>
          <span>Version: {chapterContent.version.number}</span>
          <span>•</span>
          <span>
            Last snapshot: {new Date(lastSnapshotTime).toLocaleTimeString()}
          </span>
        </div>
        <div className="footer-actions">
          <span className="auto-save-notice">
            💡 Auto-saves every {AUTO_SAVE_DELAY / 1000}s | Snapshots every {SNAPSHOT_INTERVAL / 60000}m
          </span>
        </div>
      </div>
    </div>
  );
};

export default NovelEditorPanel;

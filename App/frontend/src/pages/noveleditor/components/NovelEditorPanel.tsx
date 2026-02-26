/**
 * NovelEditorPanel - Novel Writing Interface
 *
 * Core Features:
 * - Rich text editor for chapter content
 * - Auto-cache to localStorage (persists across refresh, no backend calls)
 * - Manual save creates version snapshots (backend call)
 * - Word count tracking
 * - Save status indicators
 *
 * AI Features:
 * - AI Edit modal for content improvement
 * - Chat integration for AI assistance
 * - Tool calling for AI-generated content
 *
 * Translation Features:
 * - Multi-language support
 * - Language switcher
 * - AI translation (via Translation Modal)
 *
 * Version Management:
 * - Manual version creation via Save Snapshot button
 * - Version history sidebar
 * - Version restoration
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettings } from '../../../store/settingsStore';
import { alert as showAlert } from '../../../store/dialogStore';
import { useNovelEditorStore } from '../../../store/novelEditorStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import AIEditModal from '../../../components/Modal/AIEditModal';
import TranslationModal from '../../../components/Modal/TranslationModal';
import VersionHistoryModal from '../../../components/Modal/VersionHistoryModal';
import { UnifiedImageModal } from '../../../components/AssetManager';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { assetService, type Asset } from '../../../api/assetService';
import type { ManuscriptObject } from '../../../types/unifiedObject';
import type { TipTapDoc } from '../../../types/tiptap';
import { emptyDoc, normalizeDoc, docWordCount } from '../../../editor/manuscript/doc';
import type { GenerationRecipe } from '../../../imageTask';
import { fromAsset } from '../../../imageTask/recipe/fromAsset';
import ChapterSidebar from './ChapterSidebar';
import ManuscriptEditor, { type ManuscriptEditorRef } from './ManuscriptEditor';
import { Save, Check, Bullet, Warning, HamburgerMenu, AIAssist, Refresh, Globe, Lightbulb, MoreHorizontal, Clock } from '../../../components/icons';
import { IconButton } from '../../../components/IconButton';
import { TextButton } from '../../../components/TextButton';
import { Loading } from '../../../components/common/Loading';
import './NovelEditorPanel.css';

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
  globalDisplayLanguage: string;
  onSelectChapter: (chapterId: string) => void;
}

// Constants
const AUTO_SAVE_DELAY = 2000; // 2 seconds
const CACHE_KEY_PREFIX = 'novel_editor_cache_';

// Helper to get localStorage cache key for manuscript content
const getCacheKey = (manuscriptId: string, language: string) =>
  `${CACHE_KEY_PREFIX}${manuscriptId}_${language}`;

const NovelEditorPanel: React.FC<NovelEditorPanelProps> = ({
  projectId,
  selectedChapter,
  selectedChapterId,
  hasChapters,
  chaptersInitialized,
  globalDisplayLanguage,
  onSelectChapter,
}) => {
  const { t } = useTranslation();

  // Granular selectors to avoid unnecessary re-renders (Zustand best practice)
  const storeObjects = useUnifiedObjectStore((state) => state.objects);
  const storeLoading = useUnifiedObjectStore((state) => state.loading);
  const storeErrors = useUnifiedObjectStore((state) => state.errors);

  // Actions accessed via getState() - doesn't trigger re-renders
  const fetchObject = useUnifiedObjectStore.getState().fetchObject;
  const updateObject = useUnifiedObjectStore.getState().updateObject;
  const settings = useSettings();
  // Get stable action references to avoid infinite loops in effects
  const setHasUnsavedChangesAction = useNovelEditorStore((state) => state.setHasUnsavedChanges);
  const setIsSavingAction = useNovelEditorStore((state) => state.setIsSaving);

  // Sidebar state from unified sidebar store
  const toggleSidebar = useSidebarStore((state) => state.toggleSidebar);

  // State
  const [manuscriptId, setManuscriptId] = useState<string | null>(null);
  const [isResolvingContentId, setIsResolvingContentId] = useState(false);
  const [contentIdError, setContentIdError] = useState<string | null>(null);
  const [isAIEditModalOpen, setIsAIEditModalOpen] = useState(false);
  const [aiEditSessionId, setAiEditSessionId] = useState<string | null>(null);
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [cursorContext, setCursorContext] = useState<{ before: string; after: string }>({ before: '', after: '' });
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [showVersionsModal, setShowVersionsModal] = useState(false);
  // Image replace state
  const [replaceImageSrc, setReplaceImageSrc] = useState<string | null>(null);
  const [regenerateRecipe, setRegenerateRecipe] = useState<GenerationRecipe | null>(null);

  // Editor state
  const [doc, setDoc] = useState<TipTapDoc>(emptyDoc());
  const isSaving = useNovelEditorStore((state) => state.isSavingByProject[projectId] ?? false);
  const setIsSaving = (saving: boolean) => setIsSavingAction(projectId, saving);
  const [savingType, setSavingType] = useState<'auto' | 'manual' | null>(null);

  // Refs
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<ManuscriptEditorRef>(null);
  const docRef = useRef<TipTapDoc>(doc);
  docRef.current = doc;

  // AI edit session tracking is handled by journey thread state.
  const aiEditSession = undefined as any;

  useEffect(() => {
    if (!aiEditSessionId || !aiEditSession) return;
    if (aiEditSession.status === 'success') {
      if (manuscriptId) {
        fetchObject('manuscript', manuscriptId);
      }
      setAiEditSessionId(null);
      return;
    }
    if (aiEditSession.status === 'error' || aiEditSession.status === 'cancelled') {
      setAiEditSessionId(null);
    }
  }, [aiEditSessionId, aiEditSession, manuscriptId, fetchObject]);

  // Get manuscript from store
  const manuscript = manuscriptId
    ? (storeObjects[manuscriptId] as ManuscriptObject)
    : null;
  const loading = manuscriptId ? (storeLoading[manuscriptId] || false) : false;
  const error = manuscriptId ? (storeErrors[manuscriptId] || null) : null;

  // Get available languages from manuscript data
  const manuscriptLanguages = useMemo(() => {
    if (!manuscript) return [];
    return Object.keys(manuscript.data);
  }, [manuscript]);

  // Computed: Check if current language translation is missing
  const isMissingTranslation = useMemo(() => {
    if (!manuscript) return false;
    return !manuscriptLanguages.includes(globalDisplayLanguage);
  }, [manuscript, manuscriptLanguages, globalDisplayLanguage]);

  // Computed: Available source languages for translation
  const availableSourceLanguages = useMemo(() => {
    return manuscriptLanguages;
  }, [manuscriptLanguages]);

  // Compute effective display language with fallback
  // globalDisplayLanguage is now the actual language string (e.g., 'English', 'Korean')
  const { effectiveLanguage, isFallback } = useMemo(() => {
    if (!manuscript) {
      return { effectiveLanguage: globalDisplayLanguage || settings.mainLanguage, isFallback: false };
    }
    if (manuscriptLanguages.includes(globalDisplayLanguage)) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    // Fallback to first available or mainLanguage
    return { effectiveLanguage: manuscriptLanguages[0] || settings.mainLanguage, isFallback: true };
  }, [manuscript, manuscriptLanguages, globalDisplayLanguage, settings.mainLanguage]);

  // Helper to get manuscript data for a language
  const getManuscriptData = useCallback((lang: string) => {
    if (!manuscript) return { doc: emptyDoc(), wordCount: 0 };
    const data = manuscript.data[lang];
    if (data) {
      const doc = normalizeDoc((data as any).doc);
      const wordCount = typeof (data as any).wordCount === 'number' ? (data as any).wordCount : docWordCount(doc);
      return { doc, wordCount };
    }
    // Fallback to first available
    if (manuscriptLanguages.length > 0) {
      const fallbackData = manuscript.data[manuscriptLanguages[0]];
      if (fallbackData) {
        const doc = normalizeDoc((fallbackData as any).doc);
        const wordCount = typeof (fallbackData as any).wordCount === 'number' ? (fallbackData as any).wordCount : docWordCount(doc);
        return { doc, wordCount };
      }
      return { doc: emptyDoc(), wordCount: 0 };
    }
    return { doc: emptyDoc(), wordCount: 0 };
  }, [manuscript, manuscriptLanguages]);


  // Find existing manuscript
  const existingManuscript = useMemo(() => {
    if (!selectedChapterId) return null;
    const matchingObject = Object.values(storeObjects).find(
      (obj) =>
        obj.type === 'manuscript' && obj.metadata?.chapter_id === selectedChapterId
    ) as ManuscriptObject | undefined;
    return matchingObject || null;
  }, [selectedChapterId, storeObjects]);

  const linkedManuscriptIdFromChapter = useMemo(() => {
    if (!selectedChapterId) return null;
    const chapterObject = storeObjects[selectedChapterId];
    const manuscriptIdInMetadata = chapterObject?.metadata?.manuscript_id;
    return typeof manuscriptIdInMetadata === 'string' && manuscriptIdInMetadata.length > 0
      ? manuscriptIdInMetadata
      : null;
  }, [selectedChapterId, storeObjects]);

  // Computed values
  const wordCount = useMemo(() => {
    return docWordCount(doc);
  }, [doc]);

  // Use editorRef.hasChanges() which handles TipTap normalization internally
  const hasUnsavedChanges = editorRef.current?.hasChanges() ?? false;

  // Generate editor key - changes trigger editor remount for external content updates
  // This replaces the fragile isSettingContentRef approach with React's key mechanism
  // Include globalDisplayLanguage to ensure remount when user switches display language
  // Fixes bug where switching to main language after AI Edit showed empty content
  const editorKey = useMemo(() => {
    if (!manuscript) return 'loading';
    return `${manuscriptId}-${manuscript.version?.number ?? 0}-${globalDisplayLanguage}-${effectiveLanguage}`;
  }, [manuscriptId, manuscript?.version?.number, globalDisplayLanguage, effectiveLanguage]);

  // Compute initial content INLINE during render (not in an effect!)
  // This ensures the value is ready BEFORE the editor mounts with a new key
  const initialDoc = useMemo(() => {
    if (!manuscript?.data || editorKey === 'loading') return emptyDoc();
    return getManuscriptData(effectiveLanguage).doc;
  }, [manuscript?.data, editorKey, effectiveLanguage, getManuscriptData]);

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Resolve manuscript object ID when chapter selection changes
  useEffect(() => {
    if (!projectId || !selectedChapterId) {
      setManuscriptId(null);
      setContentIdError(null);
      setIsResolvingContentId(false);
      return;
    }

    // 1) Prefer manuscript already in store by chapter link.
    if (existingManuscript) {
      setManuscriptId(existingManuscript.id);
      setContentIdError(null);
      setIsResolvingContentId(false);
      return;
    }

    // 2) Resolve manuscript ID from chapter metadata.
    if (linkedManuscriptIdFromChapter) {
      setManuscriptId(linkedManuscriptIdFromChapter);
      setContentIdError(null);
      setIsResolvingContentId(!storeObjects[linkedManuscriptIdFromChapter]);
      return;
    }

    // 3) Fail fast when chapter->manuscript linkage is missing.
    setManuscriptId(null);
    setContentIdError('Failed to resolve linked manuscript.');
    setIsResolvingContentId(false);
  }, [
    projectId,
    selectedChapterId,
    existingManuscript,
    linkedManuscriptIdFromChapter,
    storeObjects,
  ]);

  // Fetch manuscript when ID is resolved but object is not in store yet
  useEffect(() => {
    if (!manuscriptId) return;
    if (manuscript) {
      setContentIdError(null);
      setIsResolvingContentId(false);
      return;
    }

    // Set a timeout to prevent infinite loading
    loadingTimeoutRef.current = setTimeout(() => {
      if (!manuscript) {
        console.error('Loading timeout - forcing error state');
        setContentIdError('Loading timeout. The manuscript is taking too long to load. Please try refreshing.');
      }
    }, 10000); // 10 second timeout

    // Defer to avoid flushSync conflict with TipTap editor during React render phase
    queueMicrotask(() => {
      // Fetch without language parameter - API returns all languages
      // effectiveLanguage (with fallback logic) will pick the right content
      fetchObject('manuscript', manuscriptId).catch((err: Error) => {
        console.error('Failed to fetch manuscript:', err);
        setContentIdError(err.message || 'Failed to load manuscript');
      }).finally(() => {
        setIsResolvingContentId(false);
      });
    });

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [manuscriptId, manuscript, fetchObject]); // Fetch only when manuscript is missing

  // Note: RichTextEditor now handles baseline tracking internally via hasChanges()
  // No need to track baselineSetRef here anymore

  // Restore content from localStorage cache if available and newer than server data
  useEffect(() => {
    if (!manuscriptId || !effectiveLanguage || !manuscript) return;

    const cacheKey = getCacheKey(manuscriptId, effectiveLanguage);
    const cached = localStorage.getItem(cacheKey);

    if (cached) {
      try {
        const { doc: cachedDoc, savedAt } = JSON.parse(cached);
        const serverUpdatedAt = new Date(manuscript.version?.created_at || 0).getTime();

        // Only restore if cache is newer than server data
        if (savedAt > serverUpdatedAt) {
          const nextDoc = normalizeDoc(cachedDoc);
          setDoc(nextDoc);
          editorRef.current?.setDoc(nextDoc);
          // Note: Editor baseline is set from server content on mount,
          // so hasChanges() will correctly return true for cached changes
        }
      } catch (err) {
        console.error('Failed to restore from cache:', err);
        localStorage.removeItem(cacheKey);
      }
    }
  }, [manuscriptId, effectiveLanguage, manuscript?.version?.created_at]);

  // Sync hasUnsavedChanges to the store for cross-component access
  useEffect(() => {
    setHasUnsavedChangesAction(projectId, hasUnsavedChanges);
  }, [projectId, hasUnsavedChanges, setHasUnsavedChangesAction]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, []);

  // ============================================================================
  // SAVE HANDLERS
  // ============================================================================

  /**
   * Auto-save: Save to localStorage only (NO backend call)
   * Called on every keystroke after debounce delay
   */
  const handleAutoSave = useCallback(() => {
    if (!manuscriptId || !(editorRef.current?.hasChanges())) return;

    // Save to localStorage only - NO backend API call
    // Read from ref to avoid stale closure (doc state may lag behind by one render)
    const cacheKey = getCacheKey(manuscriptId, effectiveLanguage);
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        doc: docRef.current,
        wordCount: docWordCount(docRef.current),
        savedAt: Date.now(),
      }));
    } catch (err) {
      console.error('localStorage save failed:', err);
    }
  }, [manuscriptId, effectiveLanguage]);

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
        await updateObject('manuscript', manuscriptId, {
          data: {
            doc,
            wordCount,
          },
          language: effectiveLanguage,
          user_request: reason,
          create_new_version: true, // CREATE VERSION SNAPSHOT
        });

        // Reset editor baseline after save so hasChanges() returns false
        editorRef.current?.resetBaseline();

        // Clear localStorage cache after successful save
        const cacheKey = getCacheKey(manuscriptId, effectiveLanguage);
        localStorage.removeItem(cacheKey);
      } catch (err) {
        console.error('Manual save failed:', err);
        showAlert({ title: 'Save Error', message: 'Failed to save. Please try again.' });
      } finally {
        setIsSaving(false);
        setSavingType(null);
      }
    },
    [manuscript, manuscriptId, doc, wordCount, effectiveLanguage]
  );

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handleDocChange = useCallback(
    (newDoc: TipTapDoc) => {
      setDoc(normalizeDoc(newDoc));

      // Clear existing auto-save timeout
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }

      // Schedule new auto-save (only if there are actual changes)
      if (editorRef.current?.hasChanges()) {
        autoSaveTimeoutRef.current = setTimeout(() => {
          handleAutoSave();
        }, AUTO_SAVE_DELAY);
      }
    },
    [handleAutoSave]
  );

  // Handle image selection from AssetManagerModal
  const handleImageSelect = useCallback((asset: Asset) => {
    const newSrc = asset.file_url;

    // If we're replacing an existing image
    if (replaceImageSrc && editorRef.current) {
      // Use the editor's updateImageSrc method to replace the image
      const updated = editorRef.current.updateImageSrc(replaceImageSrc, newSrc, asset.name, asset.id);

      if (!updated) {
        console.error('Failed to find and update image:', { from: replaceImageSrc, to: newSrc });
      }

      setReplaceImageSrc(null);
      setRegenerateRecipe(null);
      setShowImageModal(false);
      return;
    }

    // Normal insert at cursor
    if (editorRef.current) {
      editorRef.current.insertImage(newSrc, asset.name, asset.id);
    }
    setRegenerateRecipe(null);
    setShowImageModal(false);
  }, [replaceImageSrc]);

  // Handle browse assets - opens UnifiedImageModal in scene mode
  const handleBrowseAssets = useCallback(() => {
    if (editorRef.current) {
      const context = editorRef.current.getTextAroundCursor();
      setCursorContext(context);
    }
    setReplaceImageSrc(null);
    setRegenerateRecipe(null);
    setShowImageModal(true);
  }, []);

  // Handle swap image from overlay - opens modal with EMPTY prompts
  // User can pick from library or generate new from scratch
  const handleSwapImage = useCallback((currentSrc: string, _imageBounds: DOMRect | null) => {
    setReplaceImageSrc(currentSrc);
    setRegenerateRecipe(null);
    // Get cursor context for scene context
    if (editorRef.current) {
      const context = editorRef.current.getTextAroundCursor();
      setCursorContext(context);
    }
    setShowImageModal(true);
  }, []);

  // Handle regenerate image from overlay - opens modal with original settings prefilled (like Retry UX)
  // User still manually selects a new image from the library to replace the current one.
  const handleRegenerateImage = useCallback((currentSrc: string, _imageBounds: DOMRect | null) => {
    setReplaceImageSrc(currentSrc);
    // Get cursor context for scene context
    if (editorRef.current) {
      const context = editorRef.current.getTextAroundCursor();
      setCursorContext(context);
    }

    void (async () => {
      const asset = await assetService.getAssetByUrl(projectId, currentSrc);
      if (!asset) {
        showAlert({ title: 'Regenerate Image', message: 'Could not find this image in the library. Opening Change mode.' });
        setRegenerateRecipe(null);
        setShowImageModal(true);
        return;
      }

      const recipe = fromAsset(asset);
      if (!recipe) {
        showAlert({ title: 'Regenerate Image', message: 'This image has no saved generation settings. Opening Change mode.' });
        setRegenerateRecipe(null);
        setShowImageModal(true);
        return;
      }

      setRegenerateRecipe(recipe);
      setShowImageModal(true);
    })();
  }, [projectId]);

  // ============================================================================
  // RENDER
  // ============================================================================

  if (!selectedChapterId) {
    const isChapterMissing = chaptersInitialized && !hasChapters;
    const heading = isChapterMissing
      ? t('novelEditor.emptyState.noChapters')
      : chaptersInitialized
        ? t('novelEditor.emptyState.loadingChapter')
        : t('novelEditor.emptyState.loadingChapters');
    const description = isChapterMissing
      ? t('novelEditor.emptyState.createChaptersHint')
      : chaptersInitialized
        ? t('novelEditor.emptyState.openingChapter')
        : t('novelEditor.emptyState.loadingOutline');

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
        <Loading size="lg" text={t('novelEditor.loading.chapterContent')} />
      </div>
    );
  }

  if (contentIdError) {
    return (
      <div className="novel-editor-panel error">
        <h3>{t('novelEditor.error.chapterContentError')}</h3>
        <p>{contentIdError}</p>
      </div>
    );
  }

  if (loading && !manuscript) {
    return (
      <div className="novel-editor-panel loading">
        <Loading size="lg" />
        <p>{t('novelEditor.loading.manuscript')}</p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', marginTop: '0.5rem' }}>
          Manuscript ID: {manuscriptId}
        </p>
        <div style={{ marginTop: '1rem' }}>
          <TextButton
            variant="secondary"
            onClick={() => {
              if (manuscriptId) {
                fetchObject('manuscript', manuscriptId);
              }
            }}
          >
            {t('novelEditor.error.retry')}
          </TextButton>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="novel-editor-panel error">
        <h3>{t('novelEditor.error.errorLoading')}</h3>
        <p>{error}</p>
        <TextButton
          variant="secondary"
          onClick={() => manuscriptId && fetchObject('manuscript', manuscriptId)}
        >
          {t('novelEditor.error.retry')}
        </TextButton>
      </div>
    );
  }

  if (!manuscript) {
    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-state-content">
          <h2>{t('novelEditor.emptyState.manuscriptNotFound')}</h2>
          <p>{t('novelEditor.emptyState.noManuscriptContent')}</p>
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
                  <h2
                    className={`editor-chapter-title ${selectedChapter.description ? 'has-description' : ''}`}
                    onClick={selectedChapter.description ? () => setIsDescriptionExpanded(!isDescriptionExpanded) : undefined}
                    title={selectedChapter.description ? (isDescriptionExpanded ? 'Hide description' : 'Show description') : undefined}
                  >
                    {selectedChapter.name}
                  </h2>

                  {/* Desktop: Status Info - Save status + Word count (stacked vertically) */}
                  <div className="editor-status-info">
                    <div className="save-status">
                      {isSaving && savingType === 'auto' && <span className="saving-indicator"><Save size="xs" /> {t('novelEditor.saveStatus.autoSaving')}</span>}
                      {isSaving && savingType === 'manual' && <span className="saving-indicator"><Save size="xs" /> {t('novelEditor.saveStatus.saving')}</span>}
                      {!isSaving && hasUnsavedChanges && <span className="unsaved-indicator"><Bullet size="xs" /> {t('novelEditor.saveStatus.unsaved')}</span>}
                      {!isSaving && !hasUnsavedChanges && <span className="saved-indicator"><Check size="xs" /> {t('novelEditor.saveStatus.saved')}</span>}
                    </div>
                    <div className="word-count">
                      <span>{t('novelEditor.wordCount', { count: wordCount })}</span>
                    </div>
                  </div>

                  {/* Fallback Warning */}
                  {isFallback && (
                    <span className="fallback-warning" title={`${globalDisplayLanguage} not available, showing ${effectiveLanguage}`}>
                      <Warning size="sm" /> {effectiveLanguage}
                    </span>
                  )}

                  {/* Sidebar Toggle Button */}
                  <IconButton
                    icon={<HamburgerMenu size="md" />}
                    onClick={() => toggleSidebar(projectId, 'chapter')}
                    title={t('novelEditor.sidebar.title')}
                    size="sm"
                    className="sidebar-toggle-btn"
                  />
                </div>

                {/* Collapsible Description */}
                {selectedChapter.description && (
                  <div className={`editor-chapter-description-wrapper ${isDescriptionExpanded ? 'expanded' : ''}`}>
                    <p className="editor-chapter-description">{selectedChapter.description}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Editor */}
          <div className={`editor-content ${isMissingTranslation ? 'disabled' : ''}`}>
            <ManuscriptEditor
              key={editorKey}
              ref={editorRef}
              initialDoc={isMissingTranslation ? emptyDoc() : initialDoc}
              onChange={handleDocChange}
              placeholder="Start writing your chapter..."
              disabled={isSaving || isMissingTranslation}
              onBrowseAssets={handleBrowseAssets}
              onSwapImage={handleSwapImage}
              onRegenerateImage={handleRegenerateImage}
              toolbarActions={
                <>
                  {/* AI Edit Button */}
                  <TextButton
                    variant="primary"
                    size="sm"
                    onClick={() => setIsAIEditModalOpen(true)}
                    disabled={isSaving || !selectedChapter}
                    title={t('novelEditor.toolbar.objectEditChapter')}
                    iconLeft={<AIAssist size="sm" />}
                    className="desktop-only"
                  >
                    {t('novelEditor.toolbar.objectEdit')}
                  </TextButton>

                  {/* Manual Save Button */}
                  <TextButton
                    variant="secondary"
                    size="sm"
                    onClick={() => handleManualSave('Manual Save')}
                    disabled={isSaving || !hasUnsavedChanges}
                    title={t('novelEditor.toolbar.saveSnapshot')}
                    iconLeft={<Save size="sm" />}
                    className="desktop-only"
                  >
                    {t('novelEditor.toolbar.save')}
                  </TextButton>

                  {/* More Actions Dropdown - contains mobile-hidden actions */}
                  <DropdownMenu
                    trigger={
                      <IconButton
                        icon={<MoreHorizontal size="sm" />}
                        disabled={isSaving}
                        title={t('novelEditor.toolbar.moreActions')}
                        size="sm"
                      />
                    }
                  >
                    {/* AI Edit - accessible via dropdown on mobile */}
                    <DropdownItem
                      icon={<AIAssist size="sm" />}
                      label={t('novelEditor.toolbar.objectEdit')}
                      onClick={() => setIsAIEditModalOpen(true)}
                      disabled={isSaving || !selectedChapter}
                      className="mobile-only-item"
                    />
                    {/* Save - accessible via dropdown on mobile */}
                    <DropdownItem
                      icon={<Save size="sm" />}
                      label={t('novelEditor.toolbar.save')}
                      onClick={() => handleManualSave('Manual Save')}
                      disabled={isSaving || !hasUnsavedChanges}
                      className="mobile-only-item"
                    />
                    {/* Show Translate/Retranslate only when sub languages exist */}
                    {settings.subLanguages && settings.subLanguages.length > 0 && (
                      manuscriptLanguages.includes(globalDisplayLanguage) ? (
                        <DropdownItem
                          icon={<Refresh size="sm" />}
                          label={t('novelEditor.toolbar.retranslate')}
                          onClick={() => setShowRetranslateModal(true)}
                          disabled={isSaving}
                        />
                      ) : (
                        <DropdownItem
                          icon={<Globe size="sm" />}
                          label={t('novelEditor.toolbar.translate')}
                          onClick={() => setShowRetranslateModal(true)}
                          disabled={isSaving || !manuscript}
                        />
                      )
                    )}
                    {/* Versions */}
                    <DropdownItem
                      icon={<Clock size="sm" />}
                      label={t('novelEditor.toolbar.versions')}
                      onClick={() => setShowVersionsModal(true)}
                      disabled={isSaving || !selectedChapter || !manuscriptId}
                    />
                  </DropdownMenu>
                </>
              }
            />
            {/* Missing Translation Overlay */}
            {isMissingTranslation && (
              <div className="missing-translation-overlay">
                <div className="overlay-content">
                  <h3>{t('novelEditor.overlay.noContentIn', { language: globalDisplayLanguage })}</h3>
                  <p>{t('novelEditor.overlay.noContentYet', { language: globalDisplayLanguage })}</p>
                  <div className="overlay-actions">
                    {availableSourceLanguages.length > 0 && (
                      <TextButton
                        variant="primary"
                        onClick={() => setShowRetranslateModal(true)}
                      >
                        {t('novelEditor.overlay.translateFrom', { language: availableSourceLanguages[0] })}
                      </TextButton>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="editor-footer">
            <div className="editor-footer-info">
              <span>{t('novelEditor.footer.language')}: {effectiveLanguage}</span>
              <span>•</span>
              <span>{t('novelEditor.footer.version')}: {manuscript.version.number}</span>
            </div>
            <div className="editor-footer-notice">
              <Lightbulb size="sm" /> {t('novelEditor.footer.autoCachedLocally')}
            </div>
          </div>
        </div>

        {/* Chapter Sidebar */}
        <ChapterSidebar
          projectId={projectId}
          selectedChapterId={selectedChapterId}
          onSelectChapter={onSelectChapter}
          displayLanguage={globalDisplayLanguage}
        />
      </div>

      {/* AI Edit Modal */}
      {selectedChapter && (
        <AIEditModal
          isOpen={isAIEditModalOpen}
          onClose={() => setIsAIEditModalOpen(false)}
          category="manuscript"
          projectId={projectId}
          targetId={selectedChapter.id}
          onTaskStarted={(sessionId) => setAiEditSessionId(sessionId)}
        />
      )}

      {/* Translation Modal */}
      {manuscript && manuscriptId && (
        <TranslationModal
          isOpen={showRetranslateModal}
          onClose={() => setShowRetranslateModal(false)}
          projectId={projectId}
          preSelectedObjectIds={[manuscriptId]}
          defaultSourceLanguage={
            isMissingTranslation && availableSourceLanguages.length > 0
              ? availableSourceLanguages[0]
              : manuscriptLanguages[0] || settings.mainLanguage
          }
          defaultTargetLanguage={globalDisplayLanguage}
        />
      )}

      {/* Version History Modal */}
      {manuscriptId && (
        <VersionHistoryModal
          isOpen={showVersionsModal}
          onClose={() => setShowVersionsModal(false)}
          objectType="manuscript"
          objectId={manuscriptId}
          onRestoreVersion={() => {
            // Reload manuscript after restore
            if (manuscriptId) {
              fetchObject('manuscript', manuscriptId);
            }
          }}
        />
      )}

      {/* Unified Image Modal - browse, insert, replace */}
      <UnifiedImageModal
        preset="sceneManager"
        isOpen={showImageModal}
        onClose={() => {
          setShowImageModal(false);
          setReplaceImageSrc(null);
          setRegenerateRecipe(null);
        }}
        onSelect={handleImageSelect}
        manuscriptId={manuscriptId ?? undefined}
        sceneContext={{
          preContext: cursorContext.before,
          postContext: cursorContext.after,
        }}
        initialGenerationRecipe={regenerateRecipe}
        title={
          regenerateRecipe
            ? t('novelEditor.modal.regenerateImage')
            : replaceImageSrc
              ? t('novelEditor.modal.changeImage')
              : t('novelEditor.modal.insertImage')
        }
      />
    </>
  );
};

export default NovelEditorPanel;

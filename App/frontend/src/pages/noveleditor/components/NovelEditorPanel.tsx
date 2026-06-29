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
import { useObjectCollectionQuery } from '../../../data/objects/useObjectCollectionQuery';
import { useObjectQuery } from '../../../data/objects/useObjectQuery';
import { useUpdateObjectMutation } from '../../../data/objects/mutations/useUpdateObjectMutation';
import { useSettings } from '../../../data/settings';
import { alert as showAlert } from '../../../store/dialogStore';
import { useEditorStore } from '../../../store/editorStore';
import { useUiStore } from '../../../store/uiStore';
import AIEditModal from '../../../components/Modal/AIEditModal';
import TranslationModal from '../../../components/Modal/TranslationModal';
import VersionHistoryModal from '../../../components/Modal/VersionHistoryModal';
import { UnifiedImageModal } from '../../../components/AssetManager';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { assetService, type Asset } from '../../../api/assetService';
import type { ManuscriptObject, UnifiedObject } from '../../../types/unifiedObject';
import type { TipTapDoc } from '../../../types/tiptap';
import { emptyDoc, normalizeDoc, docWordCount } from '../../../editor/manuscript/doc';
import type { ImageGenerationRecipe } from '../../../imageRun';
import { recipeFromAsset } from '../../../imageRun';
import ChapterSidebar from './ChapterSidebar';
import ManuscriptEditor, { type ManuscriptEditorRef } from './ManuscriptEditor';
import { Save, Check, Bullet, Warning, HamburgerMenu, AIAssist, Refresh, Globe, Lightbulb, MoreHorizontal, Clock } from '../../../components/icons';
import { IconButton } from '../../../components/IconButton';
import { TextButton } from '../../../components/TextButton';
import { Skeleton, SkeletonText } from '../../../components/common/Skeleton';
import { requestedLanguageStateFromProjection, resolveTranslationSourceLanguage } from '../../../utils/requestedLanguage';
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

  // Manuscript/outline collections are summary-only (no rich-text body) — they resolve chapter↔manuscript links + serve a transient pre-load fallback; the active body comes from the manuscriptDetail query below.
  const manuscriptCollection = useObjectCollectionQuery(projectId, 'manuscript', globalDisplayLanguage, undefined, true);
  const outlineCollection = useObjectCollectionQuery(projectId, 'outline', globalDisplayLanguage, undefined, true);
  const storeObjects = useMemo<Record<string, UnifiedObject>>(() => {
    const map: Record<string, UnifiedObject> = {};
    for (const obj of [...(manuscriptCollection.data ?? []), ...(outlineCollection.data ?? [])]) {
      map[obj.id] = obj;
    }
    return map;
  }, [manuscriptCollection.data, outlineCollection.data]);
  // Whether the outline collection loaded for the current language; avoids a false "Failed to resolve linked manuscript" while chapters load.
  const chaptersHydrated = !outlineCollection.isLoading;

  const updateObjectMutation = useUpdateObjectMutation();
  const settings = useSettings();
  // Get stable action references to avoid infinite loops in effects
  const setHasUnsavedChangesAction = useEditorStore((state) => state.setHasUnsavedChanges);
  const setIsSavingAction = useEditorStore((state) => state.setIsSaving);

  // Sidebar state from unified sidebar store
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  // State
  const [manuscriptId, setManuscriptId] = useState<string | null>(null);
  // Active manuscript content (tiptap). staleTime: Infinity + refetchOnMount: false — the editor owns the buffer, so the cache only changes via save/refetch/SSE, never yanked mid-typing.
  const manuscriptDetail = useObjectQuery('manuscript', manuscriptId ?? undefined, globalDisplayLanguage, {
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const [isResolvingContentId, setIsResolvingContentId] = useState(false);
  const [contentIdError, setContentIdError] = useState<string | null>(null);
  const [isAIEditModalOpen, setIsAIEditModalOpen] = useState(false);
  const [aiEditSessionId, setAiEditSessionId] = useState<string | null>(null);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [cursorContext, setCursorContext] = useState<{ before: string; after: string }>({ before: '', after: '' });
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [showVersionsModal, setShowVersionsModal] = useState(false);
  // Image replace state
  const [replaceImageSrc, setReplaceImageSrc] = useState<string | null>(null);
  const [regenerateRecipe, setRegenerateRecipe] = useState<ImageGenerationRecipe | null>(null);

  // Editor state
  const [doc, setDoc] = useState<TipTapDoc>(emptyDoc());
  const isSaving = useEditorStore((state) => state.isSavingByProject[projectId] ?? false);
  const setIsSaving = useCallback((saving: boolean) => {
    setIsSavingAction(projectId, saving);
  }, [projectId, setIsSavingAction]);
  const [savingType, setSavingType] = useState<'auto' | 'manual' | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  // Refs
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<ManuscriptEditorRef>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const selfSavedVersionRef = useRef<number | null>(null);
  const editorBaselineRef = useRef<{ id: string | null; lang: string; version: number | null }>({ id: null, lang: '', version: null });
  const docRef = useRef<TipTapDoc>(doc);
  docRef.current = doc;

  // AI edit session tracking is handled by journey thread state.
  const aiEditSession = undefined as any;

  useEffect(() => {
    if (!aiEditSessionId || !aiEditSession) return;
    if (aiEditSession.status === 'success') {
      if (manuscriptId) {
        void manuscriptDetail.refetch();
      }
      setAiEditSessionId(null);
      return;
    }
    if (aiEditSession.status === 'error' || aiEditSession.status === 'cancelled') {
      setAiEditSessionId(null);
    }
  }, [aiEditSessionId, aiEditSession, manuscriptId, manuscriptDetail]);

  // Active manuscript: prefer the detail query (fresh after save), fall back to the collection copy while the detail is loading.
  const manuscript = ((manuscriptDetail.data as ManuscriptObject | undefined)
    ?? (manuscriptId ? (storeObjects[manuscriptId] as ManuscriptObject | undefined) : undefined))
    ?? null;
  const loading = manuscriptId ? manuscriptDetail.isLoading : false;
  const error = manuscriptId
    ? (manuscriptDetail.error ? (manuscriptDetail.error.message || 'Failed to load manuscript') : null)
    : null;
  // True only when the shown manuscript matches the active display language; on language change it may momentarily be the previous language's object, treated as "not ready" so the skeleton appears immediately.
  const manuscriptLanguageReady = manuscript
    ? manuscript.language_state?.requested_language === globalDisplayLanguage
    : false;

  const manuscriptLanguages = useMemo(() => {
    if (!manuscript) return [];
    return manuscript.language_state.available_languages;
  }, [manuscript]);

  // Computed: Available source languages for translation
  const availableSourceLanguages = useMemo(() => {
    return manuscriptLanguages;
  }, [manuscriptLanguages]);

  const languageState = useMemo(
    () => requestedLanguageStateFromProjection(manuscript?.language_state, settings.mainLanguage),
    [manuscript, settings.mainLanguage],
  );
  const isMissingTranslation = !languageState.canEdit;
  const effectiveLanguage = languageState.viewLanguage;
  const isFallback = languageState.isFallbackView;
  const saveLabel = languageState.isTranslationView
    ? 'Save Translation'
    : t('novelEditor.toolbar.save');
  const canShowAIEdit = languageState.isMainLanguage;

  // Helper to get manuscript data for a language
  const getManuscriptData = useCallback((lang: string) => {
    void lang;
    if (!manuscript) return { doc: emptyDoc(), wordCount: 0 };
    const data = manuscript.data;
    const nextDoc = normalizeDoc((data as any).content);
    const wordCount = typeof (data as any).wordCount === 'number' ? (data as any).wordCount : docWordCount(nextDoc);
    return { doc: nextDoc, wordCount };
  }, [manuscript]);


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

  const serverDoc = useMemo(() => {
    if (!manuscript?.data) return emptyDoc();
    return getManuscriptData(effectiveLanguage).doc;
  }, [manuscript?.data, effectiveLanguage, getManuscriptData]);

  const editorKey = useMemo(() => {
    if (!manuscript || !manuscriptId) return 'loading';
    return `${manuscriptId}-${globalDisplayLanguage}-${effectiveLanguage}-${reloadNonce}`;
  }, [manuscriptId, manuscript, globalDisplayLanguage, effectiveLanguage, reloadNonce]);

  const initialDoc = useMemo(() => {
    if (editorKey === 'loading') return emptyDoc();
    return serverDoc;
  }, [editorKey, serverDoc]);

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

    // 3) Neither resolved. If chapters for this language aren't hydrated yet, it's still loading — show the skeleton, not a false error; only report a missing link once hydrated.
    setManuscriptId(null);
    if (!chaptersHydrated) {
      setContentIdError(null);
      setIsResolvingContentId(true);
      return;
    }
    setContentIdError('Failed to resolve linked manuscript.');
    setIsResolvingContentId(false);
  }, [
    projectId,
    selectedChapterId,
    existingManuscript,
    linkedManuscriptIdFromChapter,
    storeObjects,
    chaptersHydrated,
  ]);

  // The detail query auto-fetches when manuscriptId / language changes; here we only mirror its state into the panel's resolving / error UI.
  useEffect(() => {
    if (!manuscriptId) return;
    if (manuscript && manuscriptLanguageReady) {
      setContentIdError(null);
      setIsResolvingContentId(false);
      return;
    }
    if (manuscriptDetail.isError) {
      const message = manuscriptDetail.error instanceof Error
        ? manuscriptDetail.error.message
        : 'Failed to load manuscript';
      setContentIdError(message || 'Failed to load manuscript');
      setIsResolvingContentId(false);
    }
  }, [manuscriptId, manuscript, manuscriptLanguageReady, manuscriptDetail.isError, manuscriptDetail.error]);

  // RichTextEditor handles baseline tracking internally via hasChanges(); no baselineSetRef needed here.

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
          docRef.current = nextDoc;
          setDoc(nextDoc);
          editorRef.current?.setDoc(nextDoc);
          // Editor baseline is set from server content on mount, so hasChanges() correctly returns true for cached changes.
        }
      } catch (err) {
        console.error('Failed to restore from cache:', err);
        localStorage.removeItem(cacheKey);
      }
    }
  }, [manuscriptId, effectiveLanguage, manuscript]);

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

  // Remount only on external version changes; self-saves are recorded and skipped.
  useEffect(() => {
    const id = manuscriptId;
    const lang = effectiveLanguage;
    const version = manuscript?.version?.number ?? null;
    const base = editorBaselineRef.current;

    if (base.id !== id || base.lang !== lang) {
      editorBaselineRef.current = { id, lang, version };
      return;
    }
    if (version === null || version === base.version) return;
    editorBaselineRef.current = { id, lang, version };
    if (version === selfSavedVersionRef.current) {
      selfSavedVersionRef.current = null;
      return;
    }
    setReloadNonce((n) => n + 1);
  }, [manuscriptId, effectiveLanguage, manuscript?.version?.number]);

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
      if (!manuscript || !manuscriptId || !editorRef.current?.hasChanges()) return;

      const latestDoc = normalizeDoc(editorRef.current?.getDoc() ?? docRef.current);
      const latestWordCount = docWordCount(latestDoc);

      docRef.current = latestDoc;
      setDoc(latestDoc);

      setIsSaving(true);
      setSavingType('manual');

      try {
        await updateObjectMutation.mutateAsync({
          type: 'manuscript',
          id: manuscriptId,
          request: {
            data: {
              content: latestDoc,
              wordCount: latestWordCount,
            },
            language: languageState.requestedLanguage,
            rich_text_format: 'tiptap',
            user_request: reason,
            create_new_version: languageState.createNewVersion,
          },
        }, {
          // record our version so the watcher skips this save's echo
          onSuccess: (updated) => {
            selfSavedVersionRef.current = (updated as ManuscriptObject)?.version?.number ?? null;
          },
        });

        setDoc(latestDoc);
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
    [languageState.createNewVersion, languageState.requestedLanguage, manuscript, manuscriptId, setIsSaving, updateObjectMutation]
  );

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handleDocChange = useCallback(
    (newDoc: TipTapDoc) => {
      const normalized = normalizeDoc(newDoc);
      docRef.current = normalized;
      setDoc(normalized);

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;

      const focusNode = e.target instanceof Node ? e.target : document.activeElement;
      if (!panelRef.current || !(focusNode instanceof Node) || !panelRef.current.contains(focusNode)) {
        return;
      }

      e.preventDefault();

      if (isSaving) return;
      if (!languageState.canEdit) return;
      if (!editorRef.current?.hasChanges()) return;

      void handleManualSave('Manual Save');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleManualSave, isSaving, languageState.canEdit]);

  // Handle image selection from AssetManagerModal
  const handleImageSelect = useCallback((asset: Asset) => {
    const newSrc = asset.file_url;

    // If we're replacing an existing image
    if (replaceImageSrc && editorRef.current) {
      // Use the editor's updateImageSrc method to replace the image
      const updated = editorRef.current.updateImageSrc(
        replaceImageSrc,
        newSrc,
        asset.id,
        asset.id,
        asset.name,
      );

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
      editorRef.current.insertImage(newSrc, asset.id, asset.id, asset.name);
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

  // Handle swap image from overlay - opens modal with EMPTY prompts; user can pick from library or generate from scratch.
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

  // Handle regenerate image from overlay - opens modal with original settings prefilled (Retry UX); user still picks a new image from the library.
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

      const recipe = recipeFromAsset(asset);
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

  const manuscriptSkeleton = (
    <div className="novel-editor-panel loading">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--spacing-md)',
          width: '100%',
          maxWidth: '760px',
          margin: '0 auto',
          padding: 'var(--spacing-2xl)',
        }}
      >
        <Skeleton width="45%" height={28} />
        <SkeletonText lines={3} />
        <SkeletonText lines={5} />
        <SkeletonText lines={4} />
      </div>
    </div>
  );

  const renderPanelBody = () => {
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
    return manuscriptSkeleton;
  }

  if (contentIdError) {
    return (
      <div className="novel-editor-panel error">
        <h3>{t('novelEditor.error.chapterContentError')}</h3>
        <p>{contentIdError}</p>
      </div>
    );
  }

  // Gate on the detail body, not the content-less summary fallback, to avoid an empty-editor flash.
  if (loading && !manuscriptDetail.data) {
    return manuscriptSkeleton;
  }

  if (error) {
    return (
      <div className="novel-editor-panel error">
        <h3>{t('novelEditor.error.errorLoading')}</h3>
        <p>{error}</p>
        <TextButton
          variant="secondary"
          onClick={() => { if (manuscriptId) void manuscriptDetail.refetch(); }}
        >
          {t('novelEditor.error.retry')}
        </TextButton>
      </div>
    );
  }

  if (!manuscript) {
    // Chapters still loading for this language — show the skeleton, not "not found".
    if (!chaptersHydrated) return manuscriptSkeleton;
    return (
      <div className="novel-editor-panel empty-state">
        <div className="empty-state-content">
          <h2>{t('novelEditor.emptyState.manuscriptNotFound')}</h2>
          <p>{t('novelEditor.emptyState.noManuscriptContent')}</p>
        </div>
      </div>
    );
  }

  // Shown manuscript is still the previous language's projection right after a language switch — show the skeleton; the fetch effect above is already loading this language.
  if (!manuscriptLanguageReady) {
    return manuscriptSkeleton;
  }

  // Keep the skeleton until both the chapter header and content are ready instead of rendering content without a header; guarded on hydration so a missing header doesn't loop forever.
  if (!selectedChapter && !chaptersHydrated) {
    return manuscriptSkeleton;
  }

  return (
    <>
      <div ref={panelRef} className="novel-editor-panel">
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
                  {canShowAIEdit ? (
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
                  ) : null}

                  {/* Manual Save Button */}
                  <TextButton
                    variant="secondary"
                    size="sm"
                    onClick={() => handleManualSave('Manual Save')}
                    disabled={isSaving || !languageState.canEdit || !hasUnsavedChanges}
                    title={t('novelEditor.toolbar.saveSnapshot')}
                    iconLeft={<Save size="sm" />}
                    className="desktop-only"
                  >
                    {saveLabel}
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
                    {canShowAIEdit ? (
                      <DropdownItem
                        icon={<AIAssist size="sm" />}
                        label={t('novelEditor.toolbar.objectEdit')}
                        onClick={() => setIsAIEditModalOpen(true)}
                        disabled={isSaving || !selectedChapter}
                        className="mobile-only-item"
                      />
                    ) : null}
                    {/* Save - accessible via dropdown on mobile */}
                    <DropdownItem
                      icon={<Save size="sm" />}
                      label={saveLabel}
                      onClick={() => handleManualSave('Manual Save')}
                      disabled={isSaving || !languageState.canEdit || !hasUnsavedChanges}
                      className="mobile-only-item"
                    />
                    {!languageState.isMainLanguage && (
                      languageState.hasRequestedLanguage ? (
                        <DropdownItem
                          icon={<Refresh size="sm" />}
                          label={t('novelEditor.toolbar.retranslate')}
                          onClick={() => setShowTranslationModal(true)}
                          disabled={isSaving}
                        />
                      ) : (
                        <DropdownItem
                          icon={<Globe size="sm" />}
                          label={t('novelEditor.toolbar.translate')}
                          onClick={() => setShowTranslationModal(true)}
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
                        onClick={() => setShowTranslationModal(true)}
                      >
                        {t('novelEditor.overlay.translateFrom', { language: resolveTranslationSourceLanguage(availableSourceLanguages, settings.mainLanguage) })}
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
          isOpen={showTranslationModal}
          onClose={() => setShowTranslationModal(false)}
          projectId={projectId}
          preSelectedObjectIds={[manuscriptId]}
          defaultSourceLanguage={resolveTranslationSourceLanguage(availableSourceLanguages, settings.mainLanguage)}
          defaultTargetLanguage={languageState.requestedLanguage}
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
              void manuscriptDetail.refetch();
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

  return (
    <>
      {renderPanelBody()}
      {/* Always mounted so loading-state swaps in the panel body don't unmount (close) the sidebar. */}
      <ChapterSidebar
        projectId={projectId}
        selectedChapterId={selectedChapterId}
        onSelectChapter={onSelectChapter}
        displayLanguage={globalDisplayLanguage}
      />
    </>
  );
};

export default NovelEditorPanel;

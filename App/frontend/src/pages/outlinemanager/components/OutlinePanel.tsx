import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { useDndSensors } from '../../../hooks/useDndSensors';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';
import { useObjectCollectionQuery } from '../../../data/objects/useObjectCollectionQuery';
import { useUpdateObjectMutation } from '../../../data/objects/mutations/useUpdateObjectMutation';
import { useCreateObjectMutation } from '../../../data/objects/mutations/useCreateObjectMutation';
import { useDeleteObjectMutation } from '../../../data/objects/mutations/useDeleteObjectMutation';
import { useSettings } from '../../../data/settings';
import { useUiStore } from '../../../store/uiStore';
import OutlinePanelSkeleton from './OutlinePanelSkeleton';
import AIEditModal from '../../../components/Modal/AIEditModal';
import VersionHistoryModal from '../../../components/Modal/VersionHistoryModal';
import TranslationModal from '../../../components/Modal/TranslationModal';
import OutlineSidebar from './OutlineSidebar';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import DragHandle from '../../../components/ui/DragHandle';
import { IconButton } from '../../../components/IconButton';
import { TextButton } from '../../../components/TextButton';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import { Plus, Edit, Trash, Books, MoreHorizontal, HamburgerMenu, ChevronRight, Scroll, Refresh } from '../../../components/icons';
import type { UnifiedObject, OutlineObject } from '../../../types/unifiedObject';
import { OutlineItemCard } from '../../../components/OutlineItemCard';
import ObjectCardExpanded from '../../../components/ObjectManager/ObjectCards/ObjectCardExpanded';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import { requestedLanguageStateFromProjection, resolveTranslationSourceLanguage } from '../../../utils/requestedLanguage';
import { sortOutlineObjects } from '../../../domain/outlineHierarchy';
import type { TipTapDoc } from '../../../types/tiptap';
import { emptyDoc, normalizeDoc } from '../../../editor/manuscript/doc';
import './OutlinePanel.css';

type OutlineLevel = 'outline' | 'act' | 'chapter';

interface OutlinePanelProps {
  globalDisplayLanguage: string;
}

const OutlinePanel: React.FC<OutlinePanelProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const updateMutation = useUpdateObjectMutation();
  const createMutation = useCreateObjectMutation();
  const deleteMutation = useDeleteObjectMutation();

  // Outline collection in tiptap (structure + edit data) and markdown (rendered
  // previews, replacing the old getRichTextMarkdown cache).
  const outlineQuery = useObjectCollectionQuery(projectId, 'outline', globalDisplayLanguage);
  const outlineMarkdownQuery = useObjectCollectionQuery(projectId, 'outline', globalDisplayLanguage, 'markdown');
  const showSkeleton = outlineQuery.isLoading;
  const settings = useSettings();
  const openSidebar = useUiStore((state) => state.openSidebar);

  // Index objects by id for the per-id lookups the old store projection provided.
  const serverObjects = useMemo(() => {
    const map: Record<string, UnifiedObject> = {};
    for (const obj of outlineQuery.data ?? []) {
      map[obj.id] = obj;
    }
    return map;
  }, [outlineQuery.data]);

  // Optimistic overlay for drag-and-drop reorder. While a reposition write is in
  // flight we render this locally-patched objects Record for instant feedback,
  // then clear it once the outline query refetches the server truth (the update
  // mutation invalidates the outline collection on structural metadata changes).
  const [optimisticObjects, setOptimisticObjects] = useState<Record<string, UnifiedObject> | null>(null);

  // Clear the optimistic overlay whenever fresh server data arrives.
  useEffect(() => {
    setOptimisticObjects(null);
  }, [serverObjects]);

  const projectionObjects = optimisticObjects ?? serverObjects;

  // Rendered markdown content keyed by object id (markdown-format query: data.content
  // is already rendered markdown text).
  const markdownContentById = useMemo(() => {
    const map = new Map<string, string>();
    for (const obj of outlineMarkdownQuery.data ?? []) {
      const content = (obj.data as Record<string, unknown> | undefined)?.content;
      if (typeof content === 'string') {
        map.set(obj.id, content);
      }
    }
    return map;
  }, [outlineMarkdownQuery.data]);

  const getContentMarkdown = useCallback(
    (objectId: string): string | undefined => markdownContentById.get(objectId),
    [markdownContentById],
  );

  // Selected outline state
  const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(null);

  // Unified overlay editor state (replaces per-level inline/modal editing)
  const [editingTarget, setEditingTarget] = useState<{ id: string; kind: OutlineLevel } | null>(null);
  const [creatingTarget, setCreatingTarget] = useState<{ kind: 'act' | 'chapter'; parentId: string } | null>(null);
  const [showOutlineAIModal, setShowOutlineAIModal] = useState<string | null>(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | null>(null);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [translationTargetId, setTranslationTargetId] = useState<string | null>(null);

  // Header description expansion and inline editing state
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editingDescriptionValue, setEditingDescriptionValue] = useState('');

  // AI edit modal targets (per level)
  const [showActAIModal, setShowActAIModal] = useState<string | null>(null);
  const [showChapterAIModal, setShowChapterAIModal] = useState<string | null>(null);

  // Collapse/expand state (acts and chapters only - outlines selected from sidebar)
  const [collapsedActs, setCollapsedActs] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());

  const isMainLanguageView = globalDisplayLanguage === settings.mainLanguage;

  const openTranslationModal = useCallback((objectId: string) => {
    setTranslationTargetId(objectId);
    setShowTranslationModal(true);
  }, []);

  // Get outlines, acts, and chapters from the query collection
  const outlines = useMemo(() => {
    if (!projectId) return [];

    return sortOutlineObjects(
      Object.values(projectionObjects).filter(
        (obj): obj is OutlineObject =>
          Boolean(obj && obj.type === 'outline' && obj.kind === 'outline' && obj.metadata?.project_id === projectId)
      )
    );
  }, [projectionObjects, projectId]);

  const acts = useMemo(() => {
    if (!projectId) return [];

    return sortOutlineObjects(
      Object.values(projectionObjects).filter(
        (obj): obj is OutlineObject =>
          Boolean(obj && obj.type === 'outline' && obj.kind === 'act' && obj.metadata?.project_id === projectId)
      )
    );
  }, [projectionObjects, projectId]);

  const chapters = useMemo(() => {
    if (!projectId) return [];

    return sortOutlineObjects(
      Object.values(projectionObjects).filter(
        (obj): obj is OutlineObject =>
          Boolean(obj && obj.type === 'outline' && obj.kind === 'chapter' && obj.metadata?.project_id === projectId)
      )
    );
  }, [projectionObjects, projectId]);

  // Build parent->children indexes to avoid O(N*M) filters during renders
  const actsByOutlineId = useMemo(() => {
    const map = new Map<string, OutlineObject[]>();
    for (const act of acts) {
      const outlineId = act.metadata?.parent_id as string | undefined;
      if (!outlineId) continue;
      const list = map.get(outlineId);
      if (list) {
        list.push(act);
      } else {
        map.set(outlineId, [act]);
      }
    }
    return map;
  }, [acts]);

  const chaptersByActId = useMemo(() => {
    const map = new Map<string, OutlineObject[]>();
    for (const chapter of chapters) {
      const actId = chapter.metadata?.parent_id as string | undefined;
      if (!actId) continue;
      const list = map.get(actId);
      if (list) {
        list.push(chapter);
      } else {
        map.set(actId, [chapter]);
      }
    }
    return map;
  }, [chapters]);

  // Helper functions
  const getActsForOutline = (outlineId: string): OutlineObject[] => actsByOutlineId.get(outlineId) || [];
  const getChaptersForAct = (actId: string): OutlineObject[] => chaptersByActId.get(actId) || [];

  // Helper to get projection data.
  const getDataForLanguage = (obj: UnifiedObject, lang: string) => {
    void lang;
    const data = obj.data as Record<string, any> | undefined;
    return data ? { ...data, content: normalizeDoc(data.content) } : { name: '', description: '', content: emptyDoc() };
  };

  const getLanguageState = useCallback(
    (obj: UnifiedObject) => requestedLanguageStateFromProjection(obj.language_state, globalDisplayLanguage),
    [globalDisplayLanguage],
  );

  // Auto-select first outline when outlines load
  useEffect(() => {
    if (outlines.length > 0 && !selectedOutlineId) {
      setSelectedOutlineId(outlines[0].id);
    } else if (outlines.length === 0) {
      setSelectedOutlineId(null);
    } else if (selectedOutlineId && !outlines.find(o => o.id === selectedOutlineId)) {
      // Selected outline was deleted, select first available
      setSelectedOutlineId(outlines[0]?.id || null);
    }
  }, [outlines, selectedOutlineId]);

  // Get selected outline
  const selectedOutline = useMemo(() => {
    if (!selectedOutlineId) return null;
    return outlines.find(o => o.id === selectedOutlineId) || null;
  }, [outlines, selectedOutlineId]);

  useEffect(() => {
    if (isMainLanguageView) return;
    // Creation is main-language only — close any open create overlay when switching away
    setCreatingTarget((prev) => (prev ? null : prev));
  }, [isMainLanguageView]);

  // Toggle expand/collapse for acts
  const toggleActExpand = (actId: string) => {
    setCollapsedActs(prev => {
      const next = new Set(prev);
      if (next.has(actId)) {
        next.delete(actId);
      } else {
        next.add(actId);
      }
      return next;
    });
  };

  const toggleChapterExpand = (chapterId: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  // ========================================================================
  // OUTLINE HANDLERS
  // ========================================================================

  const openEditor = useCallback((id: string, kind: OutlineLevel) => {
    const obj = projectionObjects[id] as OutlineObject | undefined;
    if (!obj) return;
    if (!getLanguageState(obj).canEdit) {
      openTranslationModal(id);
      return;
    }
    setCreatingTarget(null);
    setEditingTarget({ id, kind });
  }, [projectionObjects, getLanguageState, openTranslationModal]);

  const closeEditor = useCallback(() => setEditingTarget(null), []);

  const handleSaveOutlineItem = useCallback(async (name: string, description: string, content: TipTapDoc) => {
    if (!editingTarget) return;
    const obj = projectionObjects[editingTarget.id] as OutlineObject | undefined;
    if (!obj) return;
    const languageState = getLanguageState(obj);
    if (!languageState.canEdit) {
      openTranslationModal(editingTarget.id);
      return;
    }
    try {
      await updateMutation.mutateAsync({
        type: 'outline',
        id: editingTarget.id,
        request: {
          data: { name: name.trim(), description: description.trim(), content: normalizeDoc(content) },
          language: languageState.requestedLanguage,
          rich_text_format: 'tiptap',
          create_new_version: languageState.createNewVersion,
          user_request: 'Manual Edit',
        },
      });
      closeEditor();
    } catch (error) {
      console.error('Failed to update outline item:', error);
      showAlert({ title: 'Update Error', message: 'Failed to save changes. Please try again.' });
    }
  }, [editingTarget, updateMutation, projectionObjects, getLanguageState, openTranslationModal, closeEditor]);

  // Inline description editing handlers
  const handleStartEditDescription = () => {
    if (!selectedOutlineId || !selectedOutline) return;
    const languageState = getLanguageState(selectedOutline);
    if (!languageState.canEdit) {
      openTranslationModal(selectedOutlineId);
      return;
    }
    setEditingDescriptionValue(selectedOutlineData.description || '');
    setIsEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    if (!selectedOutlineId) return;

    const outline = projectionObjects[selectedOutlineId] as OutlineObject;
    if (!outline) return;

    const languageState = getLanguageState(outline);
    if (!languageState.canEdit) {
      openTranslationModal(selectedOutlineId);
      return;
    }

    try {
      await updateMutation.mutateAsync({
        type: 'outline',
        id: selectedOutlineId,
        request: {
          data: {
            name: selectedOutlineData.name,
            description: editingDescriptionValue.trim()
          },
          language: languageState.requestedLanguage,
          create_new_version: languageState.createNewVersion,
          user_request: 'Manual Edit',
        },
      });
      setIsEditingDescription(false);
    } catch (error) {
      console.error('Failed to update outline description:', error);
      showAlert({ title: 'Update Error', message: 'Failed to update outline description. Please try again.' });
    }
  };

  const handleCancelEditDescription = () => {
    setIsEditingDescription(false);
    setEditingDescriptionValue('');
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancelEditDescription();
    }
    // Ctrl/Cmd + Enter to save
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSaveDescription();
    }
  };

  const handleDeleteOutline = async (outlineId: string) => {
    const confirmed = await confirm({
      title: 'Delete Outline',
      message: 'Are you sure you want to delete this outline? All acts and chapters within it will also be deleted.',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
      return;
    }

    if (!projectId) return;
    try {
      await deleteMutation.mutateAsync({ type: 'outline', id: outlineId, projectId });
    } catch (error) {
      console.error('Failed to delete outline:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete outline. Please try again.' });
    }
  };

  // ========================================================================
  // ACT HANDLERS
  // ========================================================================

  const handleAddAct = async (outlineId: string, name: string, description: string, content: TipTapDoc) => {
    if (!projectId || !name.trim() || !isMainLanguageView) return;

    try {
      const outlineActs = getActsForOutline(outlineId);
      const actOrder = outlineActs.length;
      await createMutation.mutateAsync({
        type: 'outline',
        projectId,
        data: { name: name.trim(), description: description.trim(), content: normalizeDoc(content) },
        language: settings.mainLanguage,
        metadata: { parent_id: outlineId, position: actOrder },
        userRequest: 'User Creation',
        kind: 'act',
      });
    } catch (error) {
      console.error('Failed to create act:', error);
      showAlert({ title: 'Create Error', message: 'Failed to create act. Please try again.' });
    }
  };

  const handleDeleteAct = async (actId: string) => {
    const confirmed = await confirm({
      title: 'Delete Act',
      message: 'Are you sure you want to delete this act? All chapters within it will also be deleted.',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
      return;
    }

    if (!projectId) return;
    try {
      await deleteMutation.mutateAsync({ type: 'outline', id: actId, projectId });
    } catch (error) {
      console.error('Failed to delete act:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete act. Please try again.' });
    }
  };

  // ========================================================================
  // CHAPTER HANDLERS
  // ========================================================================

  const handleAddChapter = async (actId: string, name: string, description: string, content: TipTapDoc) => {
    if (!projectId || !name.trim() || !isMainLanguageView) return;

    try {
      const actChapters = getChaptersForAct(actId);
      const chapterOrder = actChapters.length;
      await createMutation.mutateAsync({
        type: 'outline',
        projectId,
        data: { name: name.trim(), description: description.trim(), content: normalizeDoc(content) },
        language: settings.mainLanguage,
        metadata: { parent_id: actId, position: chapterOrder },
        userRequest: 'User Creation',
        kind: 'chapter',
      });
    } catch (error) {
      console.error('Failed to create chapter:', error);
      showAlert({ title: 'Create Error', message: 'Failed to create chapter. Please try again.' });
    }
  };

  const handleDeleteChapter = async (chapterId: string) => {
    const confirmed = await confirm({
      title: 'Delete Chapter',
      message: 'Are you sure you want to delete this chapter?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
      return;
    }

    if (!projectId) return;
    try {
      await deleteMutation.mutateAsync({ type: 'outline', id: chapterId, projectId });
    } catch (error) {
      console.error('Failed to delete chapter:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete chapter. Please try again.' });
    }
  };

  // Create handler for the overlay (isNewItem mode) — dispatches by level
  const handleCreateOutlineItem = useCallback(async (name: string, description: string, content: TipTapDoc) => {
    if (!creatingTarget) return;
    if (creatingTarget.kind === 'act') {
      await handleAddAct(creatingTarget.parentId, name, description, content);
    } else {
      await handleAddChapter(creatingTarget.parentId, name, description, content);
    }
    setCreatingTarget(null);
  }, [creatingTarget, handleAddAct, handleAddChapter]);

  // Get selected outline data for header
  const selectedOutlineData = useMemo(() => {
    if (!selectedOutline) return { name: 'Select Outline', description: '', content: emptyDoc() };
    const languageState = getLanguageState(selectedOutline);
    return getDataForLanguage(selectedOutline, languageState.viewLanguage);
  }, [getLanguageState, selectedOutline]);

  const selectedOutlineLanguageState = useMemo(
    () => (selectedOutline ? getLanguageState(selectedOutline) : null),
    [getLanguageState, selectedOutline],
  );
  const selectedOutlineContentMarkdown = useMemo(
    () => (selectedOutline ? getContentMarkdown(selectedOutline.id) : undefined),
    [getContentMarkdown, selectedOutline],
  );
  const editingObject = useMemo(
    () => (editingTarget ? (projectionObjects[editingTarget.id] as OutlineObject | undefined) ?? null : null),
    [editingTarget, projectionObjects],
  );
  const editingLanguageState = useMemo(
    () => (editingObject ? getLanguageState(editingObject) : null),
    [editingObject, getLanguageState],
  );
  const editingData = useMemo<{ name: string; description: string; content: TipTapDoc }>(
    () => {
      if (!editingObject || !editingLanguageState) {
        return { name: '', description: '', content: emptyDoc() };
      }
      const data = getDataForLanguage(editingObject, editingLanguageState.viewLanguage);
      return {
        name: data.name ?? '',
        description: data.description ?? '',
        content: normalizeDoc(data.content),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingObject, editingLanguageState],
  );

  // Get acts for selected outline
  const selectedOutlineActs = useMemo(
    () => (selectedOutlineId ? actsByOutlineId.get(selectedOutlineId) || [] : []),
    [selectedOutlineId, actsByOutlineId]
  );

  // Global chapter numbering for selected outline (across all acts)
  const chapterNumberById = useMemo(() => {
    const map = new Map<string, number>();
    let chapterNumber = 1;

    for (const act of selectedOutlineActs) {
      const actChapters = chaptersByActId.get(act.id) || [];
      for (const chapter of actChapters) {
        map.set(chapter.id, chapterNumber);
        chapterNumber += 1;
      }
    }

    return map;
  }, [selectedOutlineActs, chaptersByActId]);

  // Handle opening sidebar (desktop only)
  const handleOpenSidebar = () => {
    if (projectId) {
      openSidebar(projectId, 'outline');
    }
  };

  // ========================================================================
  // DRAG AND DROP
  // ========================================================================

  const sensors = useDndSensors();

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  const actIds = useMemo(
    () => selectedOutlineActs.map((act) => act.id),
    [selectedOutlineActs]
  );

  const handleActDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id || !projectId) return;

      const oldIndex = selectedOutlineActs.findIndex((a) => a.id === active.id);
      const newIndex = selectedOutlineActs.findIndex((a) => a.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Optimistic update: reorder and assign new positions immediately by
      // overlaying a locally-patched objects Record. The overlay clears once the
      // outline query refetches (the update mutation invalidates the outline
      // collection because the request carries structural metadata).
      const reordered = arrayMove(selectedOutlineActs, oldIndex, newIndex);
      setOptimisticObjects(() => {
        const next = { ...projectionObjects };
        reordered.forEach((act, i) => {
          next[act.id] = { ...act, metadata: { ...act.metadata, position: i } } as UnifiedObject;
        });
        return next;
      });

      try {
        const activeObject = selectedOutlineActs.find((a) => a.id === active.id) as UnifiedObject | undefined;
        const languageState = activeObject
          ? getLanguageState(activeObject)
          : requestedLanguageStateFromProjection(undefined, settings.mainLanguage);
        await updateMutation.mutateAsync({
          type: 'outline',
          id: active.id as string,
          request: {
            data: getDataForLanguage((activeObject as UnifiedObject) || { data: {} } as UnifiedObject, languageState.viewLanguage),
            language: languageState.viewLanguage,
            metadata: { parent_id: selectedOutlineId, position: newIndex },
            create_new_version: false,
            user_request: 'Reposition act',
          },
        });
      } catch (error) {
        setOptimisticObjects(null);
        console.error('Failed to reorder acts:', error);
        showAlert({ title: 'Reorder Error', message: 'Failed to reorder acts. Please try again.' });
      }
    },
    [selectedOutlineActs, projectionObjects, projectId, updateMutation, getLanguageState, settings.mainLanguage, selectedOutlineId]
  );

  const makeChapterDragEndHandler = useCallback(
    (actId: string) => async (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id || !projectId) return;

      const actChapters = chaptersByActId.get(actId) || [];
      const ids = actChapters.map((ch) => ch.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      // Optimistic update: reorder and assign new positions immediately by
      // overlaying a locally-patched objects Record. The overlay clears once the
      // outline query refetches (the update mutation invalidates the outline
      // collection because the request carries structural metadata).
      const reordered = arrayMove(actChapters, oldIndex, newIndex);
      setOptimisticObjects(() => {
        const next = { ...projectionObjects };
        reordered.forEach((ch, i) => {
          next[ch.id] = { ...ch, metadata: { ...ch.metadata, position: i } } as UnifiedObject;
        });
        return next;
      });

      try {
        const activeObject = actChapters.find((ch) => ch.id === active.id) as UnifiedObject | undefined;
        const languageState = activeObject
          ? getLanguageState(activeObject)
          : requestedLanguageStateFromProjection(undefined, settings.mainLanguage);
        await updateMutation.mutateAsync({
          type: 'outline',
          id: active.id as string,
          request: {
            data: getDataForLanguage((activeObject as UnifiedObject) || { data: {} } as UnifiedObject, languageState.viewLanguage),
            language: languageState.viewLanguage,
            metadata: { parent_id: actId, position: newIndex },
            create_new_version: false,
            user_request: 'Reposition chapter',
          },
        });
      } catch (error) {
        setOptimisticObjects(null);
        console.error('Failed to reorder chapters:', error);
        showAlert({ title: 'Reorder Error', message: 'Failed to reorder chapters. Please try again.' });
      }
    },
    [projectionObjects, projectId, updateMutation, chaptersByActId, getLanguageState, settings.mainLanguage]
  );

  // Handle version history
  const handleShowVersionHistory = () => {
    if (selectedOutlineId) {
      setVersionHistoryTargetId(selectedOutlineId);
      setShowVersionHistory(true);
    }
  };

  const handleRestoreVersion = async () => {
    const targetId = versionHistoryTargetId ?? selectedOutlineId;
    if (!targetId) return;
    try {
      await Promise.all([outlineQuery.refetch(), outlineMarkdownQuery.refetch()]);
    } catch (error) {
      console.error('Failed to refresh after restore:', error);
    }
  };

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="outline-panel">
      <div className="outline-panel-header">
        <div className="header-top-row">
          <div
            className="header-title-section"
            onClick={() => selectedOutlineId && setIsDescriptionExpanded(!isDescriptionExpanded)}
          >
            {selectedOutlineId && (
              <span className={`expand-toggle ${isDescriptionExpanded ? 'expanded' : ''}`}>
                <ChevronRight size="xs" />
              </span>
            )}
            <h2>{selectedOutlineData.name || 'Outline'}</h2>
          </div>

          <div className="header-actions">
            {selectedOutlineId && (
              <>
                {isMainLanguageView ? (
                  <TextButton
                    onClick={() => selectedOutlineId && setCreatingTarget({ kind: 'act', parentId: selectedOutlineId })}
                    iconLeft={<Plus size="xs" />}
                    size="sm"
                  >
                    Add Act
                  </TextButton>
                ) : null}
                <DropdownMenu
                  trigger={
                    <IconButton
                      icon={<MoreHorizontal size="sm" />}
                      title="More actions"
                      size="sm"
                      variant="ghost"
                    />
                  }
                  align="right"
                >
                  <DropdownItem
                    icon={<Scroll size="sm" />}
                    label="Version History"
                    onClick={handleShowVersionHistory}
                  />
                </DropdownMenu>
              </>
            )}
            <TextButton
              onClick={handleOpenSidebar}
              iconLeft={<HamburgerMenu size="xs" />}
              size="sm"
              variant="ghost"
              className="desktop-only"
            >
              Select Outline
            </TextButton>
          </div>
        </div>

        {selectedOutlineId && (
          <div className={`description-section ${isDescriptionExpanded ? 'expanded' : ''}`}>
            {isEditingDescription ? (
              <div className="description-edit-container">
                <textarea
                  value={editingDescriptionValue}
                  onChange={(e) => setEditingDescriptionValue(e.target.value)}
                  onKeyDown={handleDescriptionKeyDown}
                  autoFocus
                  placeholder="Enter description..."
                />
                <div className="description-edit-actions">
                  <TextButton size="sm" variant="ghost" onClick={handleCancelEditDescription}>
                    Cancel
                  </TextButton>
                  <TextButton size="sm" onClick={handleSaveDescription}>
                    {selectedOutlineLanguageState?.isTranslationView ? 'Save Translation' : 'Save'}
                  </TextButton>
                </div>
              </div>
            ) : (
              <div className="description-display">
                <p className="description-text">
                  {selectedOutlineData.description || 'No description'}
                </p>
                {selectedOutlineLanguageState?.canEdit ? (
                  <button
                    className="description-edit-button"
                    onClick={handleStartEditDescription}
                    title="Edit description"
                  >
                    <Edit size="xs" />
                  </button>
                ) : (
                  <TextButton size="sm" variant="ghost" onClick={handleStartEditDescription}>
                    Translate
                  </TextButton>
                )}
              </div>
            )}
            {selectedOutlineContentMarkdown?.trim() && (
              <div className="outline-header-content">
                <MarkdownRenderer className="markdown-content outline-header-content__markdown">
                  {selectedOutlineContentMarkdown}
                </MarkdownRenderer>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="outline-panel-content">
        <div className="outline-manager">
          <div className="timeline-container">
            {showSkeleton ? (
              <OutlinePanelSkeleton />
            ) : (
              <>
            {/* No Outlines State */}
            {outlines.length === 0 && (
              <div className="empty-timeline-state">
                <Books size="lg" className="empty-icon" />
                <h3>No Outlines Yet</h3>
                <p>
                  {isMainLanguageView
                    ? 'Create your first outline to start organizing your story structure with acts and chapters.'
                    : `Create outlines in ${settings.mainLanguage}, then translate them into ${globalDisplayLanguage}.`}
                </p>
                {isMainLanguageView ? (
                  <TextButton onClick={handleOpenSidebar} iconLeft={<Plus />}>
                    Create First Outline
                  </TextButton>
                ) : null}
              </div>
            )}

            {/* No Outline Selected State */}
            {outlines.length > 0 && !selectedOutline && (
              <div className="empty-timeline-state">
                <Books size="lg" className="empty-icon" />
                <h3>No Outline Selected</h3>
                <p>Select an outline from the sidebar to view and manage its acts and chapters.</p>
                <TextButton onClick={handleOpenSidebar} iconLeft={<HamburgerMenu />}>
                  Select Outline
                </TextButton>
              </div>
            )}

            {/* Timeline Track for Selected Outline */}
            {selectedOutline && selectedOutlineActs.length === 0 && (
              <div className="empty-timeline-state">
                <Books size="md" className="empty-icon" />
                <h3>No Acts Yet</h3>
                <p>
                  {isMainLanguageView
                    ? 'Add acts to organize your story structure.'
                    : `Add acts in ${settings.mainLanguage}, then translate them into ${globalDisplayLanguage}.`}
                </p>
                {isMainLanguageView ? (
                  <TextButton onClick={() => selectedOutlineId && setCreatingTarget({ kind: 'act', parentId: selectedOutlineId })} iconLeft={<Plus />}>
                    Add First Act
                  </TextButton>
                ) : null}
              </div>
            )}

            {selectedOutline && selectedOutlineActs.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleActDragEnd} onDragCancel={handleDragCancel}>
                <SortableContext items={actIds} strategy={verticalListSortingStrategy}>
                  <div className="timeline-track">
                    {selectedOutlineActs.map((act, actIndex) => {
                      const actChapters = getChaptersForAct(act.id);
                      const actLanguageState = getLanguageState(act);
                      const actData = getDataForLanguage(act, actLanguageState.viewLanguage);
                      const isActExpanded = !collapsedActs.has(act.id);

                      return (
                        <SortableActGroup key={act.id} id={act.id} disabled={editingTarget?.id === act.id} isExpanded={isActExpanded}>
                          {(dragHandle) => (
                            <>
                              {/* Act Node */}
                              <div className="timeline-act-node">
                                <div
                                  className="timeline-act-node-motion"
                                  style={{ '--act-index': actIndex } as React.CSSProperties}
                                >
                                  <div className="node-marker">
                                    <span className="act-index">{actIndex + 1}</span>
                                  </div>

                                  <div className="act-content-wrapper">
                                    <OutlineItemCard
                                      variant="act"
                                      name={actData.name || 'Untitled Act'}
                                      description={actData.description}
                                      contentMarkdown={getContentMarkdown(act.id)}
                                      meta={`${actChapters.length} Chapters`}
                                      expanded={isActExpanded}
                                      showFallbackWarning={actLanguageState.isFallbackView}
                                      dragHandle={dragHandle}
                                      onHeaderClick={() => toggleActExpand(act.id)}
                                      footerActions={
                                        <>
                                          <DropdownMenu
                                            trigger={
                                              <TextButton size="sm" variant="ghost" iconLeft={<MoreHorizontal size="xs" />}>
                                                More
                                              </TextButton>
                                            }
                                          >
                                            <DropdownItem
                                              icon={<Scroll size="sm" />}
                                              label="Version History"
                                              onClick={() => {
                                                setVersionHistoryTargetId(act.id);
                                                setShowVersionHistory(true);
                                              }}
                                            />
                                            {actLanguageState.isTranslationView && (
                                              <DropdownItem icon={<Refresh size="sm" />} label="Retranslate" onClick={() => openTranslationModal(act.id)} />
                                            )}
                                            <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => handleDeleteAct(act.id)} variant="danger" />
                                          </DropdownMenu>
                                          <TextButton
                                            size="sm"
                                            variant="secondary"
                                            iconLeft={<Edit size="xs" />}
                                            onClick={() => openEditor(act.id, 'act')}
                                          >
                                            {actLanguageState.canEdit ? 'Edit' : 'Translate'}
                                          </TextButton>
                                        </>
                                      }
                                    />
                                  </div>
                                </div>
                              </div>

                              {/* Chapter Stream */}
                              <div className="chapter-stream-wrapper">
                                <div className="timeline-chapter-stream">
                                  <div className="stream-line"></div>

                                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={makeChapterDragEndHandler(act.id)} onDragCancel={handleDragCancel}>
                                    <SortableContext items={actChapters.map(ch => ch.id)} strategy={verticalListSortingStrategy}>
                                      {actChapters.map((chapter, chapterIndex) => {
                                        const chapterLanguageState = getLanguageState(chapter);
                                        const chData = getDataForLanguage(chapter, chapterLanguageState.viewLanguage);
                                        const isChapterExpanded = expandedChapters.has(chapter.id);
                                        const globalChapterIndex = chapterNumberById.get(chapter.id) ?? chapterIndex + 1;

                                        return (
                                          <SortableChapterNode key={chapter.id} id={chapter.id} disabled={editingTarget?.id === chapter.id} chapterIndex={chapterIndex}>
                                            {(chapterDragHandle) => (
                                              <>
                                                <div className="chapter-marker"></div>
                                                <div className="chapter-content-wrapper">
                                                  <OutlineItemCard
                                                    variant="chapter"
                                                    name={chData.name || 'Untitled Chapter'}
                                                    description={chData.description}
                                                    contentMarkdown={getContentMarkdown(chapter.id)}
                                                    chapterIndex={globalChapterIndex}
                                                    expanded={isChapterExpanded}
                                                    showFallbackWarning={chapterLanguageState.isFallbackView}
                                                    dragHandle={chapterDragHandle}
                                                    onHeaderClick={() => toggleChapterExpand(chapter.id)}
                                                    footerActions={
                                                      <>
                                                        <DropdownMenu
                                                          trigger={
                                                            <TextButton size="sm" variant="ghost" iconLeft={<MoreHorizontal size="xs" />}>
                                                              More
                                                            </TextButton>
                                                          }
                                                        >
                                                          <DropdownItem
                                                            icon={<Scroll size="sm" />}
                                                            label="Version History"
                                                            onClick={() => {
                                                              setVersionHistoryTargetId(chapter.id);
                                                              setShowVersionHistory(true);
                                                            }}
                                                          />
                                                          {chapterLanguageState.isTranslationView && (
                                                            <DropdownItem icon={<Refresh size="sm" />} label="Retranslate" onClick={() => openTranslationModal(chapter.id)} />
                                                          )}
                                                          <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => handleDeleteChapter(chapter.id)} variant="danger" />
                                                        </DropdownMenu>
                                                        <TextButton
                                                          size="sm"
                                                          variant="secondary"
                                                          iconLeft={<Edit size="xs" />}
                                                          onClick={() => openEditor(chapter.id, 'chapter')}
                                                        >
                                                          {chapterLanguageState.canEdit ? 'Edit' : 'Translate'}
                                                        </TextButton>
                                                      </>
                                                    }
                                                  />
                                                </div>
                                              </>
                                            )}
                                          </SortableChapterNode>
                                        );
                                      })}
                                    </SortableContext>
                                  </DndContext>

                                  {/* Add Chapter Button */}
                                  {isMainLanguageView ? (
                                    <div className="timeline-chapter-node add-chapter-node" onClick={() => setCreatingTarget({ kind: 'chapter', parentId: act.id })}>
                                      <div className="timeline-chapter-node-motion">
                                        <div className="chapter-marker add-marker"><Plus size="xs" /></div>
                                        <div className="chapter-content-wrapper">
                                          <div className="content-card add-chapter-card">
                                            <div className="add-chapter-content">
                                              <Plus size="sm" />
                                              <span>Add Chapter</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </>
                          )}
                        </SortableActGroup>
                      );
                    })}
                  </div>
                </SortableContext>

                <DragOverlay dropAnimation={null}>
                  {activeDragId && (() => {
                    const act = selectedOutlineActs.find(a => a.id === activeDragId);
                    if (act) {
                      const ls = getLanguageState(act);
                      const d = getDataForLanguage(act, ls.viewLanguage);
                      const actChapters = getChaptersForAct(act.id);
                      return (
                        <div className="outline-drag-overlay">
                          <OutlineItemCard
                            variant="act"
                            name={d.name || 'Untitled Act'}
                            description={d.description}
                            meta={`${actChapters.length} Chapters`}
                            readOnly
                          />
                        </div>
                      );
                    }
                    for (const [, chapters] of chaptersByActId) {
                      const ch = chapters.find(c => c.id === activeDragId);
                      if (ch) {
                        const ls = getLanguageState(ch);
                        const d = getDataForLanguage(ch, ls.viewLanguage);
                        return (
                          <div className="outline-drag-overlay">
                            <OutlineItemCard
                              variant="chapter"
                              name={d.name || 'Untitled Chapter'}
                              description={d.description}
                              chapterIndex={chapterNumberById.get(ch.id)}
                              readOnly
                            />
                          </div>
                        );
                      }
                    }
                    return null;
                  })()}
                </DragOverlay>
              </DndContext>
            )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Outline Sidebar */}
      {projectId && (
        <OutlineSidebar
          projectId={projectId}
          selectedOutlineId={selectedOutlineId}
          onSelectOutline={setSelectedOutlineId}
          displayLanguage={globalDisplayLanguage}
          onEditOutline={(id) => openEditor(id, 'outline')}
          onTranslateOutline={openTranslationModal}
          onRetranslateOutline={openTranslationModal}
          onAIEditOutline={(outlineId) => {
            const outline = projectionObjects[outlineId] as OutlineObject | undefined;
            if (!outline || !getLanguageState(outline).isMainLanguage) return;
            setShowOutlineAIModal(outlineId);
          }}
          onDeleteOutline={handleDeleteOutline}
          canCreateOutline={isMainLanguageView}
        />
      )}

      {/* AI Edit Modals */}
      {showOutlineAIModal && projectId && (
        <AIEditModal
          isOpen={true}
          onClose={() => setShowOutlineAIModal(null)}
          category="outline"
          projectId={projectId}
          targetId={showOutlineAIModal}
        />
      )}

      {showActAIModal && projectId && (
      <AIEditModal
          isOpen={true}
          onClose={() => setShowActAIModal(null)}
          category="outline"
          projectId={projectId}
          targetId={showActAIModal}
        />
      )}

      {showChapterAIModal && projectId && (
      <AIEditModal
          isOpen={true}
          onClose={() => setShowChapterAIModal(null)}
          category="outline"
          projectId={projectId}
          targetId={showChapterAIModal}
        />
      )}

      {/* Version History Modal (outline / act / chapter) */}
      {(versionHistoryTargetId || selectedOutlineId) && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => {
            setShowVersionHistory(false);
            setVersionHistoryTargetId(null);
          }}
          objectType="outline"
          objectId={(versionHistoryTargetId ?? selectedOutlineId) as string}
          onRestoreVersion={handleRestoreVersion}
        />
      )}

      {translationTargetId && projectId && (
        <TranslationModal
          isOpen={showTranslationModal}
          onClose={() => {
            setShowTranslationModal(false);
            setTranslationTargetId(null);
          }}
          projectId={projectId}
          preSelectedObjectIds={[translationTargetId]}
          defaultSourceLanguage={resolveTranslationSourceLanguage(
            (projectionObjects[translationTargetId] as UnifiedObject | undefined)?.language_state.available_languages ?? [],
            settings.mainLanguage,
          )}
          defaultTargetLanguage={globalDisplayLanguage}
        />
      )}

      {/* Expand-to-edit overlay (edit existing, or create new act/chapter) */}
      <AnimatePresence mode="sync">
        {editingTarget && editingObject ? (
          <motion.div
            key={`outline-edit-${editingTarget.id}`}
            className="outline-card-expanded-container"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.15 } }}
            transition={{ duration: 0.2 }}
          >
            <ObjectCardExpanded
              itemId={editingTarget.id}
              objectType={editingTarget.kind}
              hideImageTab
              mainAsset={null}
              itemData={editingData}
              effectiveLanguage={editingLanguageState?.viewLanguage ?? settings.mainLanguage}
              versionNumber={editingObject.version.number}
              readOnly={!editingLanguageState?.canEdit}
              saveLabel={editingLanguageState?.isTranslationView ? 'Save Translation' : 'Save'}
              hideAIEdit={!editingLanguageState?.isMainLanguage}
              primaryActionLabel={!editingLanguageState?.canEdit ? 'Translate' : undefined}
              onPrimaryAction={() => openTranslationModal(editingTarget.id)}
              onAIEdit={editingLanguageState?.isMainLanguage ? () => {
                if (editingTarget.kind === 'outline') setShowOutlineAIModal(editingTarget.id);
                else if (editingTarget.kind === 'act') setShowActAIModal(editingTarget.id);
                else setShowChapterAIModal(editingTarget.id);
              } : undefined}
              onRetranslate={editingLanguageState?.isTranslationView ? () => openTranslationModal(editingTarget.id) : undefined}
              onVersionHistory={() => {
                setVersionHistoryTargetId(editingTarget.id);
                setShowVersionHistory(true);
              }}
              onDelete={() => {
                const { id, kind } = editingTarget;
                closeEditor();
                if (kind === 'outline') void handleDeleteOutline(id);
                else if (kind === 'act') void handleDeleteAct(id);
                else void handleDeleteChapter(id);
              }}
              onSave={handleSaveOutlineItem}
              onCancel={closeEditor}
            />
          </motion.div>
        ) : creatingTarget ? (
          <motion.div
            key={`outline-create-${creatingTarget.kind}`}
            className="outline-card-expanded-container"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.15 } }}
            transition={{ duration: 0.2 }}
          >
            <ObjectCardExpanded
              itemId={`new-${creatingTarget.kind}`}
              objectType={creatingTarget.kind}
              hideImageTab
              mainAsset={null}
              isNewItem
              itemData={{ name: '', description: '', content: emptyDoc() }}
              effectiveLanguage={settings.mainLanguage}
              versionNumber={0}
              onSave={handleCreateOutlineItem}
              onCancel={() => setCreatingTarget(null)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

// ============================================================================
// SORTABLE WRAPPERS
// ============================================================================

interface SortableActGroupProps {
  id: string;
  disabled: boolean;
  isExpanded: boolean;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}

const SortableActGroup: React.FC<SortableActGroupProps> = ({ id, disabled, isExpanded, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const dragHandle = (
    <DragHandle
      orientation="horizontal"
      disabled={disabled}
      handleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLDivElement>}
    />
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`timeline-act-group ${isExpanded ? 'is-expanded' : 'is-collapsed'} ${isDragging ? 'is-dragging' : ''}`}
    >
      {children(dragHandle)}
    </div>
  );
};

interface SortableChapterNodeProps {
  id: string;
  disabled: boolean;
  chapterIndex: number;
  children: (dragHandle: React.ReactNode) => React.ReactNode;
}

const SortableChapterNode: React.FC<SortableChapterNodeProps> = ({ id, disabled, chapterIndex, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.5 : 1,
    '--chapter-index': chapterIndex,
  } as React.CSSProperties;

  const dragHandle = (
    <DragHandle
      orientation="horizontal"
      disabled={disabled}
      handleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLDivElement>}
    />
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`timeline-chapter-node ${isDragging ? 'is-dragging' : ''}`}
    >
      <div className="timeline-chapter-node-motion">
        {children(dragHandle)}
      </div>
    </div>
  );
};

export default OutlinePanel;

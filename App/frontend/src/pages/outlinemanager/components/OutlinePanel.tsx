import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettings } from '../../../store/settingsStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import AIEditModal from '../../../components/Modal/AIEditModal';
import VersionHistoryModal from '../../../components/Modal/VersionHistoryModal';
import TranslationModal from '../../../components/Modal/TranslationModal';
import { BaseModal } from '../../../components/BaseModal';
import OutlineSidebar from './OutlineSidebar';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import DragHandle from '../../../components/ui/DragHandle';
import { IconButton } from '../../../components/IconButton';
import { TextButton } from '../../../components/TextButton';
import { Plus, Edit, Trash, AIAssist, Books, MoreHorizontal, Save, Close, HamburgerMenu, ChevronRight, Scroll, Refresh } from '../../../components/icons';
import type { UnifiedObject, OutlineObject } from '../../../types/unifiedObject';
import { RichTextEditor, type RichTextEditorRef } from '../../../components/RichTextEditor';
import { OutlineItemCard } from '../../../components/OutlineItemCard';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import { resolveRequestedLanguageState, resolveTranslationSourceLanguage } from '../../../utils/requestedLanguage';
import './OutlinePanel.css';

interface OutlinePanelProps {
  globalDisplayLanguage: string;
}

const OutlinePanel: React.FC<OutlinePanelProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const store = useUnifiedObjectStore();
  const listObjects = useUnifiedObjectStore(state => state.listObjects);
  const settings = useSettings();
  const openSidebar = useSidebarStore((state) => state.openSidebar);

  // Selected outline state
  const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(null);

  // Editing state for outlines (sidebar handles editing and adding now)
  const [editingOutline, setEditingOutline] = useState<string | null>(null);
  const [editOutlineData, setEditOutlineData] = useState<{ name: string; description: string; content: string }>({ name: '', description: '', content: '' });
  const [showOutlineAIModal, setShowOutlineAIModal] = useState<string | null>(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [translationTargetId, setTranslationTargetId] = useState<string | null>(null);

  // Header description expansion and inline editing state
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editingDescriptionValue, setEditingDescriptionValue] = useState('');

  // Editing state for acts
  const [editingAct, setEditingAct] = useState<string | null>(null);
  const [editActData, setEditActData] = useState<{ name: string; description: string; content: string }>({ name: '', description: '', content: '' });
  const [showAddActForm, setShowAddActForm] = useState<string | null>(null);
  const [showActAIModal, setShowActAIModal] = useState<string | null>(null);

  // Editing state for chapters
  const [editingChapter, setEditingChapter] = useState<string | null>(null);
  const [editChapterData, setEditChapterData] = useState<{ name: string; description: string; content: string }>({ name: '', description: '', content: '' });
  const [showAddChapterForm, setShowAddChapterForm] = useState<string | null>(null);
  const [showChapterAIModal, setShowChapterAIModal] = useState<string | null>(null);

  // Collapse/expand state (acts and chapters only - outlines selected from sidebar)
  const [collapsedActs, setCollapsedActs] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());

  // RichTextEditor refs for content editing
  const outlineEditorRef = useRef<RichTextEditorRef>(null);
  const actEditorRef = useRef<RichTextEditorRef>(null);
  const chapterEditorRef = useRef<RichTextEditorRef>(null);

  const isMainLanguageView = globalDisplayLanguage === settings.mainLanguage;

  const openTranslationModal = useCallback((objectId: string) => {
    setTranslationTargetId(objectId);
    setShowTranslationModal(true);
  }, []);

  // Load outlines, acts, and chapters on mount
  useEffect(() => {
    if (!projectId) return;

    let isCancelled = false;
    const loadOutlineData = async () => {
      try {
        await listObjects('outline', projectId);
      } catch (error) {
        if (!isCancelled) {
          console.error('Failed to load outline data:', error);
        }
      }
    };

    loadOutlineData();
    return () => {
      isCancelled = true;
    };
  }, [projectId, listObjects]);

  // Get outlines, acts, and chapters from store
  const outlines = useMemo(() => {
    if (!projectId) return [];

    return Object.values(store.objects)
      .filter(
        (obj): obj is OutlineObject =>
          Boolean(obj && obj.type === 'outline' && obj.kind === 'outline' && obj.metadata?.project_id === projectId)
      )
      .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0));
  }, [store.objects, projectId]);

  const acts = useMemo(() => {
    if (!projectId) return [];

    return Object.values(store.objects)
      .filter(
        (obj): obj is OutlineObject =>
          Boolean(obj && obj.type === 'outline' && obj.kind === 'act' && obj.metadata?.project_id === projectId)
      )
      .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0));
  }, [store.objects, projectId]);

  const chapters = useMemo(() => {
    if (!projectId) return [];

    return Object.values(store.objects)
      .filter(
        (obj): obj is OutlineObject =>
          Boolean(obj && obj.type === 'outline' && obj.kind === 'chapter' && obj.metadata?.project_id === projectId)
      )
      .sort((a, b) => (a.metadata.position || 0) - (b.metadata.position || 0));
  }, [store.objects, projectId]);

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

  // Helper to get data for a specific language with fallback
  const getDataForLanguage = (obj: UnifiedObject, lang: string) => {
    const data = obj.data[lang];
    if (data) return data;
    const available = Object.keys(obj.data);
    return available.length > 0 ? obj.data[available[0]] : { name: '', description: '' };
  };

  const getLanguageState = useCallback((obj: UnifiedObject) => resolveRequestedLanguageState({
    availableLanguages: Object.keys(obj.data),
    requestedLanguage: globalDisplayLanguage,
    mainLanguage: settings.mainLanguage,
  }), [globalDisplayLanguage, settings.mainLanguage]);

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
    setShowAddActForm(null);
    setShowAddChapterForm(null);
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

  const startEditingOutline = (outlineId: string) => {
    const outline = store.objects[outlineId] as OutlineObject;
    if (!outline) return;
    const languageState = getLanguageState(outline);
    if (!languageState.canEdit) {
      openTranslationModal(outlineId);
      return;
    }
    const data = getDataForLanguage(outline, languageState.viewLanguage);
    setEditOutlineData({ name: data.name || '', description: data.description || '', content: data.content || '' });
    setEditingOutline(outlineId);
  };

  const handleUpdateOutline = async () => {
    if (!editingOutline || !editOutlineData.name.trim()) return;

    const outline = store.objects[editingOutline] as OutlineObject;
    if (!outline) return;

    const languageState = getLanguageState(outline);
    if (!languageState.canEdit) {
      openTranslationModal(editingOutline);
      return;
    }

    try {
      await store.updateObject('outline', editingOutline, {
        data: { name: editOutlineData.name.trim(), description: editOutlineData.description.trim(), content: editOutlineData.content.trim() },
        language: languageState.requestedLanguage,
        create_new_version: languageState.createNewVersion,
        user_request: 'Manual Edit',
      });
      setEditingOutline(null);
    } catch (error) {
      console.error('Failed to update outline:', error);
      showAlert({ title: 'Update Error', message: 'Failed to update outline. Please try again.' });
    }
  };

  const cancelEditingOutline = () => {
    setEditingOutline(null);
    setEditOutlineData({ name: '', description: '', content: '' });
  };

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

    const outline = store.objects[selectedOutlineId] as OutlineObject;
    if (!outline) return;

    const languageState = getLanguageState(outline);
    if (!languageState.canEdit) {
      openTranslationModal(selectedOutlineId);
      return;
    }

    try {
      await store.updateObject('outline', selectedOutlineId, {
        data: {
          name: selectedOutlineData.name,
          description: editingDescriptionValue.trim()
        },
        language: languageState.requestedLanguage,
        create_new_version: languageState.createNewVersion,
        user_request: 'Manual Edit',
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

    try {
      await store.deleteObject('outline', outlineId);
    } catch (error) {
      console.error('Failed to delete outline:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete outline. Please try again.' });
    }
  };

  // ========================================================================
  // ACT HANDLERS
  // ========================================================================

  const handleAddAct = async (outlineId: string, name: string, description: string, content: string) => {
    if (!projectId || !name.trim() || !isMainLanguageView) return;

    try {
      const outlineActs = getActsForOutline(outlineId);
      const actOrder = outlineActs.length;
      await store.createObject(
        'outline',
        projectId,
        { name: name.trim(), description: description.trim(), content: content.trim() },
        settings.mainLanguage,
        { parent_id: outlineId, position: actOrder },
        'User Creation',
        'act'
      );
      setShowAddActForm(null);
    } catch (error) {
      console.error('Failed to create act:', error);
      showAlert({ title: 'Create Error', message: 'Failed to create act. Please try again.' });
    }
  };

  const startEditingAct = (actId: string) => {
    const act = store.objects[actId] as OutlineObject;
    if (!act) return;
    const languageState = getLanguageState(act);
    if (!languageState.canEdit) {
      openTranslationModal(actId);
      return;
    }
    const data = getDataForLanguage(act, languageState.viewLanguage);
    setEditActData({ name: data.name || '', description: data.description || '', content: data.content || '' });
    setEditingAct(actId);
  };

  const handleUpdateAct = async () => {
    if (!editingAct || !editActData.name.trim()) return;

    const act = store.objects[editingAct] as OutlineObject;
    if (!act) return;

    const languageState = getLanguageState(act);
    if (!languageState.canEdit) {
      openTranslationModal(editingAct);
      return;
    }

    try {
      await store.updateObject('outline', editingAct, {
        data: { name: editActData.name.trim(), description: editActData.description.trim(), content: editActData.content.trim() },
        language: languageState.requestedLanguage,
        create_new_version: languageState.createNewVersion,
        user_request: 'Manual Edit',
      });
      setEditingAct(null);
    } catch (error) {
      console.error('Failed to update act:', error);
      showAlert({ title: 'Update Error', message: 'Failed to update act. Please try again.' });
    }
  };

  const cancelEditingAct = () => {
    setEditingAct(null);
    setEditActData({ name: '', description: '', content: '' });
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

    try {
      await store.deleteObject('outline', actId);
    } catch (error) {
      console.error('Failed to delete act:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete act. Please try again.' });
    }
  };

  // ========================================================================
  // CHAPTER HANDLERS
  // ========================================================================

  const handleAddChapter = async (actId: string, name: string, description: string, content: string) => {
    if (!projectId || !name.trim() || !isMainLanguageView) return;

    try {
      const actChapters = getChaptersForAct(actId);
      const chapterOrder = actChapters.length;
      await store.createObject(
        'outline',
        projectId,
        { name: name.trim(), description: description.trim(), content: content.trim() },
        settings.mainLanguage,
        { parent_id: actId, position: chapterOrder },
        'User Creation',
        'chapter'
      );
      setShowAddChapterForm(null);
    } catch (error) {
      console.error('Failed to create chapter:', error);
      showAlert({ title: 'Create Error', message: 'Failed to create chapter. Please try again.' });
    }
  };

  const startEditingChapter = (chapterId: string) => {
    const chapter = store.objects[chapterId] as OutlineObject;
    if (!chapter) return;
    const languageState = getLanguageState(chapter);
    if (!languageState.canEdit) {
      openTranslationModal(chapterId);
      return;
    }
    const data = getDataForLanguage(chapter, languageState.viewLanguage);
    setEditChapterData({ name: data.name || '', description: data.description || '', content: data.content || '' });
    setEditingChapter(chapterId);
  };

  const handleUpdateChapter = async () => {
    if (!editingChapter || !editChapterData.name.trim()) return;

    const chapter = store.objects[editingChapter] as OutlineObject;
    if (!chapter) return;

    const languageState = getLanguageState(chapter);
    if (!languageState.canEdit) {
      openTranslationModal(editingChapter);
      return;
    }

    try {
      await store.updateObject('outline', editingChapter, {
        data: { name: editChapterData.name.trim(), description: editChapterData.description.trim(), content: editChapterData.content.trim() },
        language: languageState.requestedLanguage,
        create_new_version: languageState.createNewVersion,
        user_request: 'Manual Edit',
      });
      setEditingChapter(null);
    } catch (error) {
      console.error('Failed to update chapter:', error);
      showAlert({ title: 'Update Error', message: 'Failed to update chapter. Please try again.' });
    }
  };

  const cancelEditingChapter = () => {
    setEditingChapter(null);
    setEditChapterData({ name: '', description: '', content: '' });
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

    try {
      await store.deleteObject('outline', chapterId);
    } catch (error) {
      console.error('Failed to delete chapter:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete chapter. Please try again.' });
    }
  };

  // Get selected outline data for header
  const selectedOutlineData = useMemo(() => {
    if (!selectedOutline) return { name: 'Select Outline', description: '' };
    const languageState = getLanguageState(selectedOutline);
    return getDataForLanguage(selectedOutline, languageState.viewLanguage);
  }, [getLanguageState, selectedOutline]);

  const selectedOutlineLanguageState = useMemo(
    () => (selectedOutline ? getLanguageState(selectedOutline) : null),
    [getLanguageState, selectedOutline],
  );
  const editingOutlineLanguageState = useMemo(() => {
    if (!editingOutline) return null;
    const outline = store.objects[editingOutline] as OutlineObject | undefined;
    return outline ? getLanguageState(outline) : null;
  }, [editingOutline, getLanguageState, store.objects]);

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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const actIds = useMemo(
    () => selectedOutlineActs.map((act) => act.id),
    [selectedOutlineActs]
  );

  const handleActDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !projectId) return;

      const oldIndex = selectedOutlineActs.findIndex((a) => a.id === active.id);
      const newIndex = selectedOutlineActs.findIndex((a) => a.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      try {
        const activeObject = store.objects[active.id as string] as UnifiedObject | undefined;
        const languageState = activeObject ? getLanguageState(activeObject) : resolveRequestedLanguageState({
          availableLanguages: [],
          requestedLanguage: globalDisplayLanguage,
          mainLanguage: settings.mainLanguage,
        });
        await store.updateObject('outline', active.id as string, {
          data: getDataForLanguage((activeObject as UnifiedObject) || { data: {} } as UnifiedObject, languageState.viewLanguage),
          language: languageState.viewLanguage,
          metadata: { parent_id: selectedOutlineId, position: newIndex },
          create_new_version: false,
          user_request: 'Reposition act',
        });
      } catch (error) {
        console.error('Failed to reorder acts:', error);
        showAlert({ title: 'Reorder Error', message: 'Failed to reorder acts. Please try again.' });
      }
    },
    [selectedOutlineActs, actIds, projectId, store, getLanguageState, globalDisplayLanguage, settings.mainLanguage, selectedOutlineId]
  );

  const makeChapterDragEndHandler = useCallback(
    (actId: string) => async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !projectId) return;

      const actChapters = chaptersByActId.get(actId) || [];
      const ids = actChapters.map((ch) => ch.id);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      try {
        const activeObject = store.objects[active.id as string] as UnifiedObject | undefined;
        const languageState = activeObject ? getLanguageState(activeObject) : resolveRequestedLanguageState({
          availableLanguages: [],
          requestedLanguage: globalDisplayLanguage,
          mainLanguage: settings.mainLanguage,
        });
        await store.updateObject('outline', active.id as string, {
          data: getDataForLanguage((activeObject as UnifiedObject) || { data: {} } as UnifiedObject, languageState.viewLanguage),
          language: languageState.viewLanguage,
          metadata: { parent_id: actId, position: newIndex },
          create_new_version: false,
          user_request: 'Reposition chapter',
        });
      } catch (error) {
        console.error('Failed to reorder chapters:', error);
        showAlert({ title: 'Reorder Error', message: 'Failed to reorder chapters. Please try again.' });
      }
    },
    [projectId, store, chaptersByActId, getLanguageState, globalDisplayLanguage, settings.mainLanguage]
  );

  // Handle version history
  const handleShowVersionHistory = () => {
    if (selectedOutlineId) {
      setShowVersionHistory(true);
    }
  };

  const handleRestoreVersion = async () => {
    if (!selectedOutlineId) return;
    try {
      await store.fetchObject('outline', selectedOutlineId);
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
                    onClick={() => setShowAddActForm(selectedOutlineId)}
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
          </div>
        )}
      </div>

      <div className="outline-panel-content">
        <div className="outline-manager">
          <div className="timeline-container">
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

            {/* Add Act Form (when shown) */}
            {showAddActForm === selectedOutlineId && selectedOutlineId && (
              <div className="timeline-creation-panel">
                <AddActForm
                  onAdd={(name, desc, content) => handleAddAct(selectedOutlineId, name, desc, content)}
                  onCancel={() => setShowAddActForm(null)}
                />
              </div>
            )}

            {/* Timeline Track for Selected Outline */}
            {selectedOutline && selectedOutlineActs.length === 0 && showAddActForm !== selectedOutlineId && (
              <div className="empty-timeline-state">
                <Books size="md" className="empty-icon" />
                <h3>No Acts Yet</h3>
                <p>
                  {isMainLanguageView
                    ? 'Add acts to organize your story structure.'
                    : `Add acts in ${settings.mainLanguage}, then translate them into ${globalDisplayLanguage}.`}
                </p>
                {isMainLanguageView ? (
                  <TextButton onClick={() => setShowAddActForm(selectedOutlineId)} iconLeft={<Plus />}>
                    Add First Act
                  </TextButton>
                ) : null}
              </div>
            )}

            {selectedOutline && selectedOutlineActs.length > 0 && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleActDragEnd}>
                <SortableContext items={actIds} strategy={verticalListSortingStrategy}>
                  <div className="timeline-track">
                    {selectedOutlineActs.map((act, actIndex) => {
                      const actChapters = getChaptersForAct(act.id);
                      const actLanguageState = getLanguageState(act);
                      const actData = getDataForLanguage(act, actLanguageState.viewLanguage);
                      const isActExpanded = !collapsedActs.has(act.id);

                      return (
                        <SortableActGroup key={act.id} id={act.id} disabled={editingAct === act.id} isExpanded={isActExpanded}>
                          {(dragHandle) => (
                            <>
                              {/* Act Node */}
                              <div className="timeline-act-node" style={{ '--act-index': actIndex } as React.CSSProperties}>
                                <div className="node-marker">
                                  <span className="act-index">{actIndex + 1}</span>
                                </div>

                                <div className="act-content-wrapper">
                                  {editingAct === act.id ? (
                                    <div className="outline-item-card">
                                          <div className="content-card act-card is-editing">
                                            <div className="outline-item-card__drag-slot">
                                              {dragHandle}
                                            </div>
                                            <div className="card-header">
                                              <div className="card-title-section" style={{ flex: 1 }}>
                                                <input
                                                  type="text"
                                                  className="inline-title-input"
                                                  value={editActData.name}
                                                  onChange={(e) => setEditActData(prev => ({ ...prev, name: e.target.value }))}
                                                  placeholder="Act Title"
                                                  autoFocus
                                                />
                                              </div>
                                            </div>
                                            <div className="card-body-wrapper is-expanded">
                                              <div className="card-body-content">
                                                <textarea
                                                  className="inline-description-input"
                                                  value={editActData.description}
                                                  onChange={(e) => setEditActData(prev => ({ ...prev, description: e.target.value }))}
                                                  placeholder="Describe the main events that happen in this act"
                                                  rows={4}
                                                />
                                                <div className="inline-content-editor">
                                                  <RichTextEditor
                                                    ref={actEditorRef}
                                                    key={editingAct}
                                                    initialContent={editActData.content}
                                                    onChange={(markdown) => setEditActData(prev => ({ ...prev, content: markdown }))}
                                                    placeholder="Full act content..."
                                                  />
                                                </div>
                                                <div className="edit-actions-split">
                                                  <TextButton
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={actLanguageState.isMainLanguage
                                                      ? () => setShowActAIModal(act.id)
                                                      : () => openTranslationModal(act.id)}
                                                    iconLeft={actLanguageState.isMainLanguage ? <AIAssist size="xs" /> : <Refresh size="xs" />}
                                                  >
                                                    {actLanguageState.isMainLanguage ? 'AI Edit' : 'Retranslate'}
                                                  </TextButton>
                                                  <div className="edit-actions-right">
                                                    <TextButton
                                                      variant="ghost"
                                                      size="sm"
                                                      onClick={cancelEditingAct}
                                                      iconLeft={<Close size="xs" />}
                                                    >
                                                      Cancel
                                                    </TextButton>
                                                    <TextButton
                                                      variant="secondary"
                                                      size="sm"
                                                      onClick={handleUpdateAct}
                                                      iconLeft={<Save size="xs" />}
                                                    >
                                                      {actLanguageState.isTranslationView ? 'Save Translation' : 'Save'}
                                                    </TextButton>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                    </div>
                                  ) : (
                                    <OutlineItemCard
                                      variant="act"
                                      name={actData.name || 'Untitled Act'}
                                      description={actData.description}
                                      content={actData.content}
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
                                            {actLanguageState.isTranslationView && (
                                              <DropdownItem icon={<Refresh size="sm" />} label="Retranslate" onClick={() => openTranslationModal(act.id)} />
                                            )}
                                            <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => handleDeleteAct(act.id)} variant="danger" />
                                          </DropdownMenu>
                                          <TextButton
                                            size="sm"
                                            variant="secondary"
                                            iconLeft={<Edit size="xs" />}
                                            onClick={() => (actLanguageState.canEdit ? startEditingAct(act.id) : openTranslationModal(act.id))}
                                          >
                                            {actLanguageState.canEdit ? 'Edit' : 'Translate'}
                                          </TextButton>
                                        </>
                                      }
                                    />
                                  )}
                                </div>
                              </div>

                              {/* Chapter Stream */}
                              <div className="chapter-stream-wrapper">
                                <div className="timeline-chapter-stream">
                                  <div className="stream-line"></div>

                                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={makeChapterDragEndHandler(act.id)}>
                                    <SortableContext items={actChapters.map(ch => ch.id)} strategy={verticalListSortingStrategy}>
                                      {actChapters.map((chapter, chapterIndex) => {
                                        const chapterLanguageState = getLanguageState(chapter);
                                        const chData = getDataForLanguage(chapter, chapterLanguageState.viewLanguage);
                                        const isChapterExpanded = expandedChapters.has(chapter.id);
                                        const globalChapterIndex = chapterNumberById.get(chapter.id) ?? chapterIndex + 1;

                                        return (
                                          <SortableChapterNode key={chapter.id} id={chapter.id} disabled={editingChapter === chapter.id} chapterIndex={chapterIndex}>
                                            {(chapterDragHandle) => (
                                              <>
                                                <div className="chapter-marker"></div>
                                                <div className="chapter-content-wrapper">
                                                  {editingChapter === chapter.id ? (
                                                    <div className="outline-item-card">
                                                      <div className="content-card chapter-card is-editing">
                                                        <div className="outline-item-card__drag-slot">
                                                          {chapterDragHandle}
                                                        </div>
                                                            <div className="chapter-header">
                                                              <div className="chapter-info" style={{ flex: 1 }}>
                                                                <span className="chapter-index">CH {globalChapterIndex}</span>
                                                                <input
                                                                  type="text"
                                                                  className="inline-title-input"
                                                                  value={editChapterData.name}
                                                                  onChange={(e) => setEditChapterData(prev => ({ ...prev, name: e.target.value }))}
                                                                  placeholder="Chapter Title"
                                                                  autoFocus
                                                                />
                                                              </div>
                                                            </div>
                                                            <div className="chapter-expand-wrapper is-expanded">
                                                              <div className="chapter-expand-content">
                                                                <textarea
                                                                  className="inline-description-input"
                                                                  value={editChapterData.description}
                                                                  onChange={(e) => setEditChapterData(prev => ({ ...prev, description: e.target.value }))}
                                                                  placeholder="Describe what happens in this chapter"
                                                                  rows={3}
                                                                />
                                                                <div className="inline-content-editor">
                                                                  <RichTextEditor
                                                                    ref={chapterEditorRef}
                                                                    key={editingChapter}
                                                                    initialContent={editChapterData.content}
                                                                    onChange={(markdown) => setEditChapterData(prev => ({ ...prev, content: markdown }))}
                                                                    placeholder="Full chapter content..."
                                                                  />
                                                                </div>
                                                                <div className="edit-actions-split">
                                                                  <TextButton
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    onClick={chapterLanguageState.isMainLanguage
                                                                      ? () => setShowChapterAIModal(chapter.id)
                                                                      : () => openTranslationModal(chapter.id)}
                                                                    iconLeft={chapterLanguageState.isMainLanguage ? <AIAssist size="xs" /> : <Refresh size="xs" />}
                                                                  >
                                                                    {chapterLanguageState.isMainLanguage ? 'AI Edit' : 'Retranslate'}
                                                                  </TextButton>
                                                                  <div className="edit-actions-right">
                                                                    <TextButton
                                                                      variant="ghost"
                                                                      size="sm"
                                                                      onClick={cancelEditingChapter}
                                                                      iconLeft={<Close size="xs" />}
                                                                    >
                                                                      Cancel
                                                                    </TextButton>
                                                                    <TextButton
                                                                      variant="secondary"
                                                                      size="sm"
                                                                      onClick={handleUpdateChapter}
                                                                      iconLeft={<Save size="xs" />}
                                                                    >
                                                                      {chapterLanguageState.isTranslationView ? 'Save Translation' : 'Save'}
                                                                    </TextButton>
                                                                  </div>
                                                                </div>
                                                              </div>
                                                            </div>
                                                      </div>
                                                    </div>
                                                  ) : (
                                                    <OutlineItemCard
                                                      variant="chapter"
                                                      name={chData.name || 'Untitled Chapter'}
                                                      description={chData.description}
                                                      content={chData.content}
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
                                                            {chapterLanguageState.isTranslationView && (
                                                              <DropdownItem icon={<Refresh size="sm" />} label="Retranslate" onClick={() => openTranslationModal(chapter.id)} />
                                                            )}
                                                            <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => handleDeleteChapter(chapter.id)} variant="danger" />
                                                          </DropdownMenu>
                                                          <TextButton
                                                            size="sm"
                                                            variant="secondary"
                                                            iconLeft={<Edit size="xs" />}
                                                            onClick={() => (chapterLanguageState.canEdit ? startEditingChapter(chapter.id) : openTranslationModal(chapter.id))}
                                                          >
                                                            {chapterLanguageState.canEdit ? 'Edit' : 'Translate'}
                                                          </TextButton>
                                                        </>
                                                      }
                                                    />
                                                  )}
                                                </div>
                                              </>
                                            )}
                                          </SortableChapterNode>
                                        );
                                      })}
                                    </SortableContext>
                                  </DndContext>

                                  {/* Add Chapter Button */}
                                  {isMainLanguageView && showAddChapterForm === act.id ? (
                                    <div className="timeline-chapter-node creation-node">
                                      <div className="chapter-marker creation-marker"><Plus size="xs" /></div>
                                      <div className="chapter-content-wrapper">
                                        <AddChapterForm
                                          onAdd={(name, desc, content) => handleAddChapter(act.id, name, desc, content)}
                                          onCancel={() => setShowAddChapterForm(null)}
                                        />
                                      </div>
                                    </div>
                                  ) : isMainLanguageView ? (
                                    <div className="timeline-chapter-node add-chapter-node" onClick={() => setShowAddChapterForm(act.id)}>
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
              </DndContext>
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
          onEditOutline={startEditingOutline}
          onTranslateOutline={openTranslationModal}
          onRetranslateOutline={openTranslationModal}
          onAIEditOutline={(outlineId) => {
            const outline = store.objects[outlineId] as OutlineObject | undefined;
            if (!outline || !getLanguageState(outline).isMainLanguage) return;
            setShowOutlineAIModal(outlineId);
          }}
          onDeleteOutline={handleDeleteOutline}
          canCreateOutline={isMainLanguageView}
        />
      )}

      {/* Edit Outline Modal */}
      {editingOutline && (
        <BaseModal
          isOpen={true}
          onClose={cancelEditingOutline}
          size="medium"
          title={editingOutlineLanguageState?.isTranslationView ? 'Edit Outline Translation' : 'Edit Outline'}
          footer={
            <div className="form-actions">
              <TextButton variant="ghost" size="sm" onClick={cancelEditingOutline}>
                Cancel
              </TextButton>
              <TextButton
                variant="secondary"
                size="sm"
                onClick={handleUpdateOutline}
                disabled={!editOutlineData.name.trim()}
              >
                {editingOutlineLanguageState?.isTranslationView ? 'Save Translation' : 'Save'}
              </TextButton>
            </div>
          }
        >
          <div className="item-form edit-form">
            <div className="form-group">
              <label htmlFor="edit-outline-name">Outline Title</label>
              <input
                id="edit-outline-name"
                type="text"
                value={editOutlineData.name}
                onChange={(e) => setEditOutlineData((prev) => ({ ...prev, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="edit-outline-description">Description (Optional)</label>
              <textarea
                id="edit-outline-description"
                value={editOutlineData.description}
                onChange={(e) =>
                  setEditOutlineData((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={4}
              />
            </div>
            <div className="form-group form-group-grow">
              <label>Content</label>
              <RichTextEditor
                ref={outlineEditorRef}
                key={editingOutline}
                initialContent={editOutlineData.content}
                onChange={(markdown) => setEditOutlineData((prev) => ({ ...prev, content: markdown }))}
                placeholder="Full outline content..."
              />
            </div>
          </div>
        </BaseModal>
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

      {/* Outline Version History Modal */}
      {selectedOutlineId && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          objectType="outline"
          objectId={selectedOutlineId}
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
            Object.keys((store.objects[translationTargetId] as UnifiedObject | undefined)?.data ?? {}),
            settings.mainLanguage,
          )}
          defaultTargetLanguage={globalDisplayLanguage}
        />
      )}
    </div>
  );
};

// ============================================================================
// ADD ACT FORM
// ============================================================================

interface AddActFormProps {
  onAdd: (name: string, description: string, content: string) => void;
  onCancel: () => void;
}

const AddActForm: React.FC<AddActFormProps> = ({ onAdd, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(name, description, content);
    setName('');
    setDescription('');
    setContent('');
  };

  return (
    <div className="item-form add-form">
      <h4>Add New Act</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="add-act-name">Act Title</label>
          <input
            id="add-act-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Act 1: The Beginning"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label htmlFor="add-act-description">Description (Optional)</label>
          <textarea
            id="add-act-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the main events..."
            rows={3}
          />
        </div>
        <div className="form-group form-group-grow">
          <label>Content (Optional)</label>
          <RichTextEditor
            initialContent={content}
            onChange={setContent}
            placeholder="Full act content..."
          />
        </div>
        <div className="form-actions">
          <TextButton variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </TextButton>
          <TextButton variant="secondary" size="sm" type="submit" disabled={!name.trim()}>
            Create Act
          </TextButton>
        </div>
      </form>
    </div>
  );
};

// ============================================================================
// ADD CHAPTER FORM
// ============================================================================

interface AddChapterFormProps {
  onAdd: (name: string, description: string, content: string) => void;
  onCancel: () => void;
}

const AddChapterForm: React.FC<AddChapterFormProps> = ({ onAdd, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(name, description, content);
    setName('');
    setDescription('');
    setContent('');
  };

  return (
    <div className="item-form add-form chapter-add-form">
      <h4>Add New Chapter</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="add-chapter-name">Chapter Title</label>
          <input
            id="add-chapter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Chapter 1: The Beginning"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label htmlFor="add-chapter-description">Description (Optional)</label>
          <textarea
            id="add-chapter-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happens in this chapter..."
            rows={2}
          />
        </div>
        <div className="form-group form-group-grow">
          <label>Content (Optional)</label>
          <RichTextEditor
            initialContent={content}
            onChange={setContent}
            placeholder="Full chapter content..."
          />
        </div>
        <div className="form-actions">
          <TextButton variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </TextButton>
          <TextButton variant="secondary" size="sm" type="submit" disabled={!name.trim()}>
            Create Chapter
          </TextButton>
        </div>
      </form>
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
      {children(dragHandle)}
    </div>
  );
};

export default OutlinePanel;

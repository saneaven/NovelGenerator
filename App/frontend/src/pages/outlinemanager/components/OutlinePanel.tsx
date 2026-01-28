import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import AIEditModal from '../../../components/Modal/AIEditModal';
import VersionHistoryModal from '../../../components/Modal/VersionHistoryModal';
import { BaseModal } from '../../../components/BaseModal';
import OutlineSidebar from './OutlineSidebar';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { IconButton } from '../../../components/IconButton';
import { TextButton } from '../../../components/TextButton';
import { Plus, Edit, Trash, AIAssist, Books, MoreHorizontal, Save, Close, HamburgerMenu, ChevronRight, Scroll } from '../../../components/icons';
import { Warning } from '../../../components/icons';
import type { UnifiedObject, OutlineObject, ActObject, ChapterObject } from '../../../types/unifiedObject';
import { RichTextEditor, type RichTextEditorRef } from '../../../components/RichTextEditor';
import { MarkdownRenderer } from '../../../components/MarkdownRenderer';
import './OutlinePanel.css';

interface OutlinePanelProps {
  globalDisplayLanguage: string;
}

const OutlinePanel: React.FC<OutlinePanelProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const store = useUnifiedObjectStore();
  const listObjects = useUnifiedObjectStore(state => state.listObjects);
  const settings = useSettingsStore();
  const { showError } = useErrorStore();
  const openSidebar = useSidebarStore((state) => state.openSidebar);

  // Selected outline state
  const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(null);

  // Editing state for outlines (sidebar handles editing and adding now)
  const [editingOutline, setEditingOutline] = useState<string | null>(null);
  const [editOutlineData, setEditOutlineData] = useState<{ name: string; description: string; content: string }>({ name: '', description: '', content: '' });
  const [showOutlineAIModal, setShowOutlineAIModal] = useState<string | null>(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

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

  // Load outlines, acts, and chapters on mount
  useEffect(() => {
    if (!projectId) return;

    let isCancelled = false;
    const loadOutlineData = async () => {
      try {
        await Promise.all([
          listObjects('outline', projectId),
          listObjects('act', projectId),
          listObjects('chapter', projectId),
        ]);
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
          Boolean(obj && obj.type === 'outline' && obj.metadata?.project_id === projectId)
      )
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  }, [store.objects, projectId]);

  const acts = useMemo(() => {
    if (!projectId) return [];

    return Object.values(store.objects)
      .filter(
        (obj): obj is ActObject =>
          Boolean(obj && obj.type === 'act' && obj.metadata?.project_id === projectId)
      )
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  }, [store.objects, projectId]);

  const chapters = useMemo(() => {
    if (!projectId) return [];

    return Object.values(store.objects)
      .filter(
        (obj): obj is ChapterObject =>
          Boolean(obj && obj.type === 'chapter' && obj.metadata?.project_id === projectId)
      )
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  }, [store.objects, projectId]);

  // Build parent->children indexes to avoid O(N*M) filters during renders
  const actsByOutlineId = useMemo(() => {
    const map = new Map<string, ActObject[]>();
    for (const act of acts) {
      const outlineId = act.metadata?.outline_id as string | undefined;
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
    const map = new Map<string, ChapterObject[]>();
    for (const chapter of chapters) {
      const actId = chapter.metadata?.act_id as string | undefined;
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
  const getActsForOutline = (outlineId: string): ActObject[] => actsByOutlineId.get(outlineId) || [];
  const getChaptersForAct = (actId: string): ChapterObject[] => chaptersByActId.get(actId) || [];

  // Helper to get data for a specific language with fallback
  const getDataForLanguage = (obj: UnifiedObject, lang: string) => {
    const data = obj.data[lang];
    if (data) return data;
    const available = Object.keys(obj.data);
    return available.length > 0 ? obj.data[available[0]] : { name: '', description: '' };
  };

  const getEffectiveLanguage = (obj: UnifiedObject) => {
    const available = Object.keys(obj.data);
    if (available.includes(globalDisplayLanguage)) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    return { effectiveLanguage: available[0] || globalDisplayLanguage, isFallback: true };
  };

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
    const { effectiveLanguage } = getEffectiveLanguage(outline);
    const data = getDataForLanguage(outline, effectiveLanguage);
    setEditOutlineData({ name: data.name || '', description: data.description || '', content: data.content || '' });
    setEditingOutline(outlineId);
  };

  const handleUpdateOutline = async () => {
    if (!editingOutline || !editOutlineData.name.trim()) return;

    const outline = store.objects[editingOutline] as OutlineObject;
    if (!outline) return;

    const { effectiveLanguage } = getEffectiveLanguage(outline);

    try {
      await store.updateObject('outline', editingOutline, {
        data: { name: editOutlineData.name.trim(), description: editOutlineData.description.trim(), content: editOutlineData.content.trim() },
        language: effectiveLanguage,
        create_new_version: true,
        user_request: 'Manual Edit',
      });
      setEditingOutline(null);
    } catch (error) {
      console.error('Failed to update outline:', error);
      showError('Update Error', 'Failed to update outline. Please try again.');
    }
  };

  const cancelEditingOutline = () => {
    setEditingOutline(null);
    setEditOutlineData({ name: '', description: '', content: '' });
  };

  // Inline description editing handlers
  const handleStartEditDescription = () => {
    setEditingDescriptionValue(selectedOutlineData.description || '');
    setIsEditingDescription(true);
  };

  const handleSaveDescription = async () => {
    if (!selectedOutlineId) return;

    const outline = store.objects[selectedOutlineId] as OutlineObject;
    if (!outline) return;

    const { effectiveLanguage } = getEffectiveLanguage(outline);

    try {
      await store.updateObject('outline', selectedOutlineId, {
        data: {
          name: selectedOutlineData.name,
          description: editingDescriptionValue.trim()
        },
        language: effectiveLanguage,
        create_new_version: true,
        user_request: 'Manual Edit',
      });
      setIsEditingDescription(false);
    } catch (error) {
      console.error('Failed to update outline description:', error);
      showError('Update Error', 'Failed to update outline description. Please try again.');
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
    if (!confirm('Are you sure you want to delete this outline? All acts and chapters within it will also be deleted.')) {
      return;
    }

    try {
      await store.deleteObject('outline', outlineId);
    } catch (error) {
      console.error('Failed to delete outline:', error);
      showError('Delete Error', 'Failed to delete outline. Please try again.');
    }
  };

  // ========================================================================
  // ACT HANDLERS
  // ========================================================================

  const handleAddAct = async (outlineId: string, name: string, description: string, content: string) => {
    if (!projectId || !name.trim()) return;

    try {
      const outlineActs = getActsForOutline(outlineId);
      const actOrder = outlineActs.length;
      await store.createObject(
        'act',
        projectId,
        { name: name.trim(), description: description.trim(), content: content.trim() },
        settings.settings.mainLanguage,
        { outline_id: outlineId, order: actOrder }
      );
      setShowAddActForm(null);
    } catch (error) {
      console.error('Failed to create act:', error);
      showError('Create Error', 'Failed to create act. Please try again.');
    }
  };

  const startEditingAct = (actId: string) => {
    const act = store.objects[actId] as ActObject;
    if (!act) return;
    const { effectiveLanguage } = getEffectiveLanguage(act);
    const data = getDataForLanguage(act, effectiveLanguage);
    setEditActData({ name: data.name || '', description: data.description || '', content: data.content || '' });
    setEditingAct(actId);
  };

  const handleUpdateAct = async () => {
    if (!editingAct || !editActData.name.trim()) return;

    const act = store.objects[editingAct] as ActObject;
    if (!act) return;

    const { effectiveLanguage } = getEffectiveLanguage(act);

    try {
      await store.updateObject('act', editingAct, {
        data: { name: editActData.name.trim(), description: editActData.description.trim(), content: editActData.content.trim() },
        language: effectiveLanguage,
        create_new_version: true,
        user_request: 'Manual Edit',
      });
      setEditingAct(null);
    } catch (error) {
      console.error('Failed to update act:', error);
      showError('Update Error', 'Failed to update act. Please try again.');
    }
  };

  const cancelEditingAct = () => {
    setEditingAct(null);
    setEditActData({ name: '', description: '', content: '' });
  };

  const handleDeleteAct = async (actId: string) => {
    if (!confirm('Are you sure you want to delete this act? All chapters within it will also be deleted.')) {
      return;
    }

    try {
      await store.deleteObject('act', actId);
    } catch (error) {
      console.error('Failed to delete act:', error);
      showError('Delete Error', 'Failed to delete act. Please try again.');
    }
  };

  // ========================================================================
  // CHAPTER HANDLERS
  // ========================================================================

  const handleAddChapter = async (actId: string, name: string, description: string, content: string) => {
    if (!projectId || !name.trim()) return;

    try {
      const actChapters = getChaptersForAct(actId);
      const chapterOrder = actChapters.length;
      await store.createObject(
        'chapter',
        projectId,
        { name: name.trim(), description: description.trim(), content: content.trim() },
        settings.settings.mainLanguage,
        { act_id: actId, order: chapterOrder }
      );
      setShowAddChapterForm(null);
    } catch (error) {
      console.error('Failed to create chapter:', error);
      showError('Create Error', 'Failed to create chapter. Please try again.');
    }
  };

  const startEditingChapter = (chapterId: string) => {
    const chapter = store.objects[chapterId] as ChapterObject;
    if (!chapter) return;
    const { effectiveLanguage } = getEffectiveLanguage(chapter);
    const data = getDataForLanguage(chapter, effectiveLanguage);
    setEditChapterData({ name: data.name || '', description: data.description || '', content: data.content || '' });
    setEditingChapter(chapterId);
  };

  const handleUpdateChapter = async () => {
    if (!editingChapter || !editChapterData.name.trim()) return;

    const chapter = store.objects[editingChapter] as ChapterObject;
    if (!chapter) return;

    const { effectiveLanguage } = getEffectiveLanguage(chapter);

    try {
      await store.updateObject('chapter', editingChapter, {
        data: { name: editChapterData.name.trim(), description: editChapterData.description.trim(), content: editChapterData.content.trim() },
        language: effectiveLanguage,
        create_new_version: true,
        user_request: 'Manual Edit',
      });
      setEditingChapter(null);
    } catch (error) {
      console.error('Failed to update chapter:', error);
      showError('Update Error', 'Failed to update chapter. Please try again.');
    }
  };

  const cancelEditingChapter = () => {
    setEditingChapter(null);
    setEditChapterData({ name: '', description: '', content: '' });
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (!confirm('Are you sure you want to delete this chapter?')) {
      return;
    }

    try {
      await store.deleteObject('chapter', chapterId);
    } catch (error) {
      console.error('Failed to delete chapter:', error);
      showError('Delete Error', 'Failed to delete chapter. Please try again.');
    }
  };

  // Get selected outline data for header
  const selectedOutlineData = useMemo(() => {
    if (!selectedOutline) return { name: 'Select Outline', description: '' };
    const { effectiveLanguage } = getEffectiveLanguage(selectedOutline);
    return getDataForLanguage(selectedOutline, effectiveLanguage);
  }, [selectedOutline, globalDisplayLanguage]);

  // Get acts for selected outline
  const selectedOutlineActs = selectedOutlineId ? getActsForOutline(selectedOutlineId) : [];

  // Handle opening sidebar (desktop only)
  const handleOpenSidebar = () => {
    if (projectId) {
      openSidebar(projectId, 'outline');
    }
  };

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
                <TextButton
                  onClick={() => setShowAddActForm(selectedOutlineId)}
                  iconLeft={<Plus size="xs" />}
                  size="sm"
                >
                  Add Act
                </TextButton>
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
                    Save
                  </TextButton>
                </div>
              </div>
            ) : (
              <div className="description-display">
                <p className="description-text">
                  {selectedOutlineData.description || 'No description'}
                </p>
                <button
                  className="description-edit-button"
                  onClick={handleStartEditDescription}
                  title="Edit description"
                >
                  <Edit size="xs" />
                </button>
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
                <p>Create your first outline to start organizing your story structure with acts and chapters.</p>
                <TextButton onClick={handleOpenSidebar} iconLeft={<Plus />}>
                  Create First Outline
                </TextButton>
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
                <p>Add acts to organize your story structure.</p>
                <TextButton onClick={() => setShowAddActForm(selectedOutlineId)} iconLeft={<Plus />}>
                  Add First Act
                </TextButton>
              </div>
            )}

            {selectedOutline && selectedOutlineActs.length > 0 && (
              <div className="timeline-track">
                {selectedOutlineActs.map((act, actIndex) => {
                          const actChapters = getChaptersForAct(act.id);
                          const { effectiveLanguage: actLang, isFallback: actFallback } = getEffectiveLanguage(act);
                          const actData = getDataForLanguage(act, actLang);
                          const isActExpanded = !collapsedActs.has(act.id);

                          return (
                            <div key={act.id} className={`timeline-act-group ${isActExpanded ? 'is-expanded' : 'is-collapsed'}`}>
                              {/* Act Node */}
                              <div className="timeline-act-node" style={{ '--act-index': actIndex } as React.CSSProperties}>
                                <div className="node-marker">
                                  <span className="act-index">{actIndex + 1}</span>
                                </div>

                                <div className="act-content-wrapper">
                                  <div className={`content-card act-card ${editingAct === act.id ? 'is-editing' : ''}`}>
                                    <div className="card-header">
                                      {editingAct === act.id ? (
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
                                      ) : (
                                        <div className="card-title-section" onClick={() => toggleActExpand(act.id)}>
                                          <div className="title-row">
                                            <h4>{actData.name || 'Untitled Act'}</h4>
                                            {actFallback && <span className="fallback-badge" title="Translation missing"><Warning size="xs" /></span>}
                                          </div>
                                          <span className="card-meta">{actChapters.length} Chapters</span>
                                        </div>
                                      )}
                                    </div>

                                    {editingAct === act.id ? (
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
                                              onClick={() => setShowActAIModal(act.id)}
                                              iconLeft={<AIAssist size="xs" />}
                                            >
                                              AI Edit
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
                                                Save
                                              </TextButton>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className={`card-body-wrapper ${isActExpanded ? 'is-expanded' : ''}`}>
                                        <div className="card-body-content">
                                          {actData.content ? (
                                            <MarkdownRenderer>
                                              {actData.content}
                                            </MarkdownRenderer>
                                          ) : (
                                            <p className="placeholder-text">No content provided.</p>
                                          )}
                                          <div className="card-footer-actions">
                                            <DropdownMenu
                                              trigger={
                                                <TextButton size="sm" variant="ghost" iconLeft={<MoreHorizontal size="xs" />}>
                                                  More
                                                </TextButton>
                                              }
                                            >
                                              <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => handleDeleteAct(act.id)} variant="danger" />
                                            </DropdownMenu>
                                            <TextButton
                                              size="sm"
                                              variant="secondary"
                                              iconLeft={<Edit size="xs" />}
                                              onClick={() => startEditingAct(act.id)}
                                            >
                                              Edit
                                            </TextButton>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Chapter Stream */}
                              <div className="chapter-stream-wrapper">
                                <div className="timeline-chapter-stream">
                                  <div className="stream-line"></div>

                                  {actChapters.map((chapter, chapterIndex) => {
                                    const { effectiveLanguage: chLang, isFallback: chFallback } = getEffectiveLanguage(chapter);
                                    const chData = getDataForLanguage(chapter, chLang);
                                    const isChapterExpanded = expandedChapters.has(chapter.id);

                                    return (
                                      <div
                                        key={chapter.id}
                                        className="timeline-chapter-node"
                                        style={{ '--chapter-index': chapterIndex } as React.CSSProperties}
                                      >
                                        <div className="chapter-marker"></div>
                                        <div className="chapter-content-wrapper">
                                          <div className={`content-card chapter-card ${editingChapter === chapter.id ? 'is-editing' : ''}`}>
                                            {editingChapter === chapter.id ? (
                                              <>
                                                <div className="chapter-header">
                                                  <div className="chapter-info" style={{ flex: 1 }}>
                                                    <span className="chapter-index">CH {chapterIndex + 1}</span>
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
                                                        onClick={() => setShowChapterAIModal(chapter.id)}
                                                        iconLeft={<AIAssist size="xs" />}
                                                      >
                                                        AI Edit
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
                                                          Save
                                                        </TextButton>
                                                      </div>
                                                    </div>
                                                  </div>
                                                </div>
                                              </>
                                            ) : (
                                              <>
                                                <div className="chapter-header">
                                                  <div className="chapter-info" onClick={() => toggleChapterExpand(chapter.id)}>
                                                    <span className="chapter-index">CH {chapterIndex + 1}</span>
                                                    <h4>{chData.name || 'Untitled Chapter'}</h4>
                                                    {chFallback && <Warning size="xs" className="warning-icon" />}
                                                  </div>
                                                </div>
                                                <div className={`chapter-expand-wrapper ${isChapterExpanded ? 'is-expanded' : ''}`}>
                                                  <div className="chapter-expand-content">
                                                    {chData.content ? (
                                                      <MarkdownRenderer className="markdown-content chapter-content">
                                                        {chData.content}
                                                      </MarkdownRenderer>
                                                    ) : (
                                                      <p className="placeholder-text">No content provided.</p>
                                                    )}
                                                    <div className="chapter-footer-actions">
                                                      <DropdownMenu
                                                        trigger={
                                                          <TextButton size="sm" variant="ghost" iconLeft={<MoreHorizontal size="xs" />}>
                                                            More
                                                          </TextButton>
                                                        }
                                                      >
                                                        <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => handleDeleteChapter(chapter.id)} variant="danger" />
                                                      </DropdownMenu>
                                                      <TextButton
                                                        size="sm"
                                                        variant="secondary"
                                                        iconLeft={<Edit size="xs" />}
                                                        onClick={() => startEditingChapter(chapter.id)}
                                                      >
                                                        Edit
                                                      </TextButton>
                                                    </div>
                                                  </div>
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })}

                                  {/* Add Chapter Button */}
                                  {showAddChapterForm === act.id ? (
                                    <div className="timeline-chapter-node creation-node">
                                      <div className="chapter-marker creation-marker"><Plus size="xs" /></div>
                                      <div className="chapter-content-wrapper">
                                        <AddChapterForm
                                          onAdd={(name, desc, content) => handleAddChapter(act.id, name, desc, content)}
                                          onCancel={() => setShowAddChapterForm(null)}
                                        />
                                      </div>
                                    </div>
                                  ) : (
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
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                })}
              </div>
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
          onAIEditOutline={(outlineId) => setShowOutlineAIModal(outlineId)}
          onDeleteOutline={handleDeleteOutline}
        />
      )}

      {/* Edit Outline Modal */}
      {editingOutline && (
        <BaseModal
          isOpen={true}
          onClose={cancelEditingOutline}
          size="medium"
          title="Edit Outline"
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
                Save
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
          category="act"
          projectId={projectId}
          targetId={showActAIModal}
        />
      )}

      {showChapterAIModal && projectId && (
        <AIEditModal
          isOpen={true}
          onClose={() => setShowChapterAIModal(null)}
          category="chapter"
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

export default OutlinePanel;

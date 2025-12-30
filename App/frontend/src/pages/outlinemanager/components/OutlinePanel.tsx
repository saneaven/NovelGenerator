import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useUnifiedObjectStore } from '../../../store/unifiedObjectStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { useErrorStore } from '../../../store/errorStore';
import { useSidebarStore } from '../../../store/sidebarStore';
import AIEditModal from '../../../components/AIEditModal';
import OutlineSidebar from './OutlineSidebar';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { IconButton } from '../../../components/IconButton';
import { TextButton } from '../../../components/TextButton';
import { Expand, Collapse, Plus, Edit, Trash, AIAssist, Books, MoreHorizontal, Save, Close, HamburgerMenu } from '../../../components/icons';
import { Warning } from '../../../components/icons';
import type { UnifiedObject, OutlineObject, ActObject, ChapterObject } from '../../../types/unifiedObject';
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
  const [editOutlineData, setEditOutlineData] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [showOutlineAIModal, setShowOutlineAIModal] = useState<string | null>(null);

  // Editing state for acts
  const [editingAct, setEditingAct] = useState<string | null>(null);
  const [editActData, setEditActData] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [showAddActForm, setShowAddActForm] = useState<string | null>(null);
  const [showActAIModal, setShowActAIModal] = useState<string | null>(null);

  // Editing state for chapters
  const [editingChapter, setEditingChapter] = useState<string | null>(null);
  const [editChapterData, setEditChapterData] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [showAddChapterForm, setShowAddChapterForm] = useState<string | null>(null);
  const [showChapterAIModal, setShowChapterAIModal] = useState<string | null>(null);

  // Collapse/expand state (acts and chapters only - outlines selected from sidebar)
  const [collapsedActs, setCollapsedActs] = useState<Set<string>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [expandCount, setExpandCount] = useState<Record<string, number>>({});

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

  // Helper functions
  const getActsForOutline = (outlineId: string): ActObject[] => {
    return acts
      .filter(act => act.metadata.outline_id === outlineId)
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  };

  const getChaptersForAct = (actId: string): ChapterObject[] => {
    return chapters
      .filter(chapter => chapter.metadata.act_id === actId)
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  };

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
        setExpandCount(prevCount => ({ ...prevCount, [actId]: (prevCount[actId] || 0) + 1 }));
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
    setEditOutlineData({ name: data.name || '', description: data.description || '' });
    setEditingOutline(outlineId);
  };

  const handleUpdateOutline = async () => {
    if (!editingOutline || !editOutlineData.name.trim()) return;

    const outline = store.objects[editingOutline] as OutlineObject;
    if (!outline) return;

    const { effectiveLanguage } = getEffectiveLanguage(outline);

    try {
      await store.updateObject('outline', editingOutline, {
        data: { name: editOutlineData.name.trim(), description: editOutlineData.description.trim() },
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
    setEditOutlineData({ name: '', description: '' });
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

  const handleAddAct = async (outlineId: string, name: string, description: string) => {
    if (!projectId || !name.trim()) return;

    try {
      const outlineActs = getActsForOutline(outlineId);
      const actOrder = outlineActs.length;
      await store.createObject(
        'act',
        projectId,
        { name: name.trim(), description: description.trim() },
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
    setEditActData({ name: data.name || '', description: data.description || '' });
    setEditingAct(actId);
  };

  const handleUpdateAct = async () => {
    if (!editingAct || !editActData.name.trim()) return;

    const act = store.objects[editingAct] as ActObject;
    if (!act) return;

    const { effectiveLanguage } = getEffectiveLanguage(act);

    try {
      await store.updateObject('act', editingAct, {
        data: { name: editActData.name.trim(), description: editActData.description.trim() },
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
    setEditActData({ name: '', description: '' });
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

  const handleAddChapter = async (actId: string, name: string, description: string) => {
    if (!projectId || !name.trim()) return;

    try {
      const actChapters = getChaptersForAct(actId);
      const chapterOrder = actChapters.length;
      await store.createObject(
        'chapter',
        projectId,
        { name: name.trim(), description: description.trim() },
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
    setEditChapterData({ name: data.name || '', description: data.description || '' });
    setEditingChapter(chapterId);
  };

  const handleUpdateChapter = async () => {
    if (!editingChapter || !editChapterData.name.trim()) return;

    const chapter = store.objects[editingChapter] as ChapterObject;
    if (!chapter) return;

    const { effectiveLanguage } = getEffectiveLanguage(chapter);

    try {
      await store.updateObject('chapter', editingChapter, {
        data: { name: editChapterData.name.trim(), description: editChapterData.description.trim() },
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
    setEditChapterData({ name: '', description: '' });
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

  // ========================================================================
  // RENDER
  // ========================================================================

  return (
    <div className="outline-panel">
      <div className="outline-panel-header">
        <h2>{selectedOutlineData.name || 'Outline'}</h2>

        <div className="header-actions">
          {selectedOutlineId && (
            <TextButton
              onClick={() => setShowAddActForm(selectedOutlineId)}
              iconLeft={<Plus size="xs" />}
              size="sm"
            >
              Add Act
            </TextButton>
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
                  onAdd={(name, desc) => handleAddAct(selectedOutlineId, name, desc)}
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

                                      {editingAct !== act.id && (
                                        <div className="card-actions">
                                          <IconButton
                                            icon={isActExpanded ? <Collapse size="sm" /> : <Expand size="sm" />}
                                            onClick={() => toggleActExpand(act.id)}
                                            size="sm"
                                          />
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
                                          <p>{actData.description || <span className="placeholder-text">No description provided.</span>}</p>
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
                                <div className="timeline-chapter-stream" key={`${act.id}-${expandCount[act.id] || 0}`}>
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
                                                  <div className="chapter-actions">
                                                    <IconButton
                                                      icon={isChapterExpanded ? <Collapse size="xs" /> : <Expand size="xs" />}
                                                      size="xs"
                                                      onClick={() => toggleChapterExpand(chapter.id)}
                                                    />
                                                  </div>
                                                </div>
                                                <div className={`chapter-expand-wrapper ${isChapterExpanded ? 'is-expanded' : ''}`}>
                                                  <div className="chapter-expand-content">
                                                    {chData.description && (
                                                      <p className="chapter-description">{chData.description}</p>
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
                                          onAdd={(name, desc) => handleAddChapter(act.id, name, desc)}
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
    </div>
  );
};

// ============================================================================
// ADD ACT FORM
// ============================================================================

interface AddActFormProps {
  onAdd: (name: string, description: string) => void;
  onCancel: () => void;
}

const AddActForm: React.FC<AddActFormProps> = ({ onAdd, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(name, description);
    setName('');
    setDescription('');
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
  onAdd: (name: string, description: string) => void;
  onCancel: () => void;
}

const AddChapterForm: React.FC<AddChapterFormProps> = ({ onAdd, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(name, description);
    setName('');
    setDescription('');
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

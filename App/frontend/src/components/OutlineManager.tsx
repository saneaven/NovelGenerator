import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import './OutlineManager.css';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import AIEditModal from './AIEditModal';
import TranslationModal from './TranslationModal';
import { DropdownMenu, DropdownItem, DropdownDivider } from './ui/DropdownMenu';
import { IconButton } from './IconButton';
import { TextButton } from './TextButton';
import { Expand, Collapse, Plus, Edit, Trash, AIAssist, Books, MoreHorizontal, Save, Close } from './icons';
import { Warning } from './icons';
import type { ActObject, ChapterObject } from '../types/unifiedObject';

interface OutlineManagerProps {
  globalDisplayLanguage: string;
}

const OutlineManager: React.FC<OutlineManagerProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const store = useUnifiedObjectStore();
  const listObjects = useUnifiedObjectStore(state => state.listObjects);
  const settings = useSettingsStore();
  const { showError } = useErrorStore();

  const [editingAct, setEditingAct] = useState<string | null>(null);
  const [editingChapter, setEditingChapter] = useState<string | null>(null);
  const [editActData, setEditActData] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [editChapterData, setEditChapterData] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [showAddActForm, setShowAddActForm] = useState(false);
  const [showAddChapterForm, setShowAddChapterForm] = useState<string | null>(null);
  const [showActAIModal, setShowActAIModal] = useState<string | null>(null);
  const [showChapterAIModal, setShowChapterAIModal] = useState<string | null>(null);
  const [showActVersionHistory, setShowActVersionHistory] = useState<string | null>(null);
  const [showChapterVersionHistory, setShowChapterVersionHistory] = useState<string | null>(null);
  const [showActRetranslateModal, setShowActRetranslateModal] = useState<string | null>(null);
  const [showChapterRetranslateModal, setShowChapterRetranslateModal] = useState<string | null>(null);

  // Collapse/expand state - track collapsed items (empty = all expanded)
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());
  const [expandCount, setExpandCount] = useState<Record<string, number>>({});

  // Chapter expand state - track expanded chapters (empty = all collapsed by default)
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());

  // Toggle single item expand/collapse
  const toggleItemExpand = (itemId: string) => {
    setCollapsedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        // Expanding - remove from collapsed set and increment counter to trigger animation
        next.delete(itemId);
        setExpandCount(prevCount => ({ ...prevCount, [itemId]: (prevCount[itemId] || 0) + 1 }));
      } else {
        // Collapsing - add to collapsed set
        next.add(itemId);
      }
      return next;
    });
  };

  // Toggle chapter expand/collapse
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

  // Load acts and chapters on mount
  useEffect(() => {
    if (!projectId) return;

    let isCancelled = false;
    const loadOutlineData = async () => {
      try {
        await Promise.all([
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

  // Get acts and chapters from store
  const acts = useMemo(() => {
    if (!projectId) {
      return [];
    }

    return Object.values(store.objects)
      .filter(
        (obj): obj is ActObject =>
          Boolean(obj && obj.type === 'act' && obj.metadata?.project_id === projectId)
      )
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  }, [store.objects, projectId]);

  const chapters = useMemo(() => {
    if (!projectId) {
      return [];
    }

    return Object.values(store.objects)
      .filter(
        (obj): obj is ChapterObject =>
          Boolean(obj && obj.type === 'chapter' && obj.metadata?.project_id === projectId)
      )
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  }, [store.objects, projectId]);

  // Helper to get chapters for a specific act
  const getChaptersForAct = (actId: string): ChapterObject[] => {
    return chapters
      .filter(chapter => chapter.metadata.act_id === actId)
      .sort((a, b) => (a.metadata.order || 0) - (b.metadata.order || 0));
  };

  // Check if all items are collapsed (all acts are in the collapsed set)
  const allCollapsed = acts.length > 0 && collapsedItems.size === acts.length;

  // Toggle function: expand all if collapsed, otherwise collapse all
  const toggleAllCards = () => {
    if (allCollapsed) {
      // Expand all - clear collapsed set
      setCollapsedItems(new Set());
      // Trigger animation for all
      const newExpandCount: Record<string, number> = {};
      acts.forEach(act => {
        newExpandCount[act.id] = (expandCount[act.id] || 0) + 1;
      });
      setExpandCount(prev => ({ ...prev, ...newExpandCount }));
    } else {
      // Collapse all - add all act IDs to collapsed set
      const allActIds = new Set<string>(acts.map(act => act.id));
      setCollapsedItems(allActIds);
    }
  };

  // Helper to compute effective display language with fallback
  const getActEffectiveLanguage = (act: ActObject) => {
    const available = Object.keys(act.data);
    if (available.includes(globalDisplayLanguage)) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    return { effectiveLanguage: available[0] || globalDisplayLanguage, isFallback: true };
  };

  const getChapterEffectiveLanguage = (chapter: ChapterObject) => {
    const available = Object.keys(chapter.data);
    if (available.includes(globalDisplayLanguage)) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    return { effectiveLanguage: available[0] || globalDisplayLanguage, isFallback: true };
  };

  // Helper to get data for a language with fallback
  const getActData = (act: ActObject, lang: string) => {
    const data = act.data[lang];
    if (data) return data;
    const available = Object.keys(act.data);
    return available.length > 0 ? act.data[available[0]] : { name: '', description: '' };
  };

  const getChapterData = (chapter: ChapterObject, lang: string) => {
    const data = chapter.data[lang];
    if (data) return data;
    const available = Object.keys(chapter.data);
    return available.length > 0 ? chapter.data[available[0]] : { name: '', description: '' };
  };

  // ========================================================================
  // ACT HANDLERS
  // ========================================================================

  const handleAddAct = async (name: string, description: string) => {
    if (!projectId || !name.trim()) return;

    try {
      const actOrder = acts.length;
      await store.createObject(
        'act',
        projectId,
        { name: name.trim(), description: description.trim() },
        settings.settings.mainLanguage,
        { order: actOrder }
      );
      setShowAddActForm(false);
    } catch (error) {
      console.error('Failed to create act:', error);
      showError('Create Error', 'Failed to create act. Please try again.');
    }
  };

  // Start editing an act - populate form data
  const startEditingAct = (actId: string) => {
    const act = store.objects[actId] as ActObject;
    if (!act) return;
    const { effectiveLanguage } = getActEffectiveLanguage(act);
    const actData = getActData(act, effectiveLanguage);
    setEditActData({ name: actData.name, description: actData.description });
    setEditingAct(actId);
  };

  const handleUpdateAct = async () => {
    if (!editingAct || !editActData.name.trim()) return;

    const act = store.objects[editingAct] as ActObject;
    if (!act) return;

    const { effectiveLanguage } = getActEffectiveLanguage(act);

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
      // Delete all chapters in this act first
      const actChapters = getChaptersForAct(actId);
      for (const chapter of actChapters) {
        await store.deleteObject('chapter', chapter.id);
      }

      // Delete the act
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
      const chapterOrder = getChaptersForAct(actId).length;
      await store.createObject(
        'chapter',
        projectId,
        { name: name.trim(), description: description.trim() },
        settings.settings.mainLanguage,
        {
          act_id: actId,
          order: chapterOrder
        }
      );
      setShowAddChapterForm(null);
    } catch (error) {
      console.error('Failed to create chapter:', error);
      showError('Create Error', 'Failed to create chapter. Please try again.');
    }
  };

  // Start editing a chapter - populate form data
  const startEditingChapter = (chapterId: string) => {
    const chapter = store.objects[chapterId] as ChapterObject;
    if (!chapter) return;
    const { effectiveLanguage } = getChapterEffectiveLanguage(chapter);
    const chData = getChapterData(chapter, effectiveLanguage);
    setEditChapterData({ name: chData.name, description: chData.description });
    setEditingChapter(chapterId);
  };

  const handleUpdateChapter = async () => {
    if (!editingChapter || !editChapterData.name.trim()) return;

    const chapter = store.objects[editingChapter] as ChapterObject;
    if (!chapter) return;

    const { effectiveLanguage } = getChapterEffectiveLanguage(chapter);

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

  // ========================================================================
  // AI & VERSION HISTORY HANDLERS
  // ========================================================================

  const handleActAIResult = async (result: any) => {
    if (!projectId || !showActAIModal) return;

    const act = store.objects[showActAIModal] as ActObject;
    if (!act) return;

    if (result && result.name !== undefined && result.description !== undefined) {
      const { effectiveLanguage } = getActEffectiveLanguage(act);

      try {
        await store.updateObject('act', showActAIModal, {
          data: { name: result.name, description: result.description },
          language: effectiveLanguage,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        setShowActAIModal(null);
      } catch (error) {
        console.error('Failed to apply AI result:', error);
      }
    }
  };

  const handleChapterAIResult = async (result: any) => {
    if (!projectId || !showChapterAIModal) return;

    const chapter = store.objects[showChapterAIModal] as ChapterObject;
    if (!chapter) return;

    if (result && result.name !== undefined && result.description !== undefined) {
      const { effectiveLanguage } = getChapterEffectiveLanguage(chapter);

      try {
        await store.updateObject('chapter', showChapterAIModal, {
          data: { name: result.name, description: result.description },
          language: effectiveLanguage,
          create_new_version: true,
          user_request: 'AI Edit',
        });
        setShowChapterAIModal(null);
      } catch (error) {
        console.error('Failed to apply AI result:', error);
      }
    }
  };

  const handleRestoreActVersion = async (versionId: string) => {
    if (!showActVersionHistory) return;

    try {
      await store.restoreVersion('act', showActVersionHistory, versionId);
      setShowActVersionHistory(null);
    } catch (error) {
      console.error('Failed to restore version:', error);
      showError('Restore Error', 'Failed to restore version. Please try again.');
    }
  };

  const handleRestoreChapterVersion = async (versionId: string) => {
    if (!showChapterVersionHistory) return;

    try {
      await store.restoreVersion('chapter', showChapterVersionHistory, versionId);
      setShowChapterVersionHistory(null);
    } catch (error) {
      console.error('Failed to restore version:', error);
      showError('Restore Error', 'Failed to restore version. Please try again.');
    }
  };

  // ========================================================================
  // RENDER
  // ========================================================================

  if (!projectId) {
    return (
      <div className="error-container">
        <p>Project ID not found.</p>
      </div>
    );
  }

  return (
    <div className="outline-manager">
      <div className="section-header">
        <h2>Story Outline</h2>
        <div className="header-buttons">
          <TextButton
            variant="ghost"
            size="sm"
            onClick={toggleAllCards}
            title={allCollapsed ? "Expand All" : "Collapse All"}
            iconLeft={allCollapsed ? <Collapse size="xs" /> : <Expand size="xs" />}
            className="desktop-only action-button"
          >
            {allCollapsed ? "Expand" : "Collapse"}
          </TextButton>
          <TextButton
            variant="secondary"
            size="sm"
            onClick={() => setShowAddActForm(true)}
            disabled={showAddActForm}
            iconLeft={<Plus size="xs" />}
            className="desktop-only action-button"
          >
            Add Act
          </TextButton>
          <DropdownMenu
            trigger={
              <IconButton
                icon={<MoreHorizontal size="sm" />}
                title="More actions"
                size="sm"
                className="mobile-only"
              />
            }
          >
            <DropdownItem
              icon={allCollapsed ? <Collapse size="sm" /> : <Expand size="sm" />}
              label={allCollapsed ? "Expand All" : "Collapse All"}
              onClick={toggleAllCards}
            />
            <DropdownDivider />
            <DropdownItem
              icon={<Plus size="sm" />}
              label="Add Act"
              onClick={() => setShowAddActForm(true)}
              disabled={showAddActForm}
            />
          </DropdownMenu>
        </div>
      </div>
      <div className="section-divider" />
      <div className="timeline-container">

      {showAddActForm && (
        <div className="timeline-creation-panel">
          <AddActForm
            onAdd={handleAddAct}
            onCancel={() => setShowAddActForm(false)}
          />
        </div>
      )}

      <div className="timeline-track">
        {acts.length === 0 ? (
          <div className="empty-timeline-state">
            <div className="empty-icon"><Books size="lg" /></div>
            <h3>Start Your Story</h3>
            <p>Create the first act to begin outlining your masterpiece.</p>
            <TextButton 
              variant="primary" 
              onClick={() => setShowAddActForm(true)}
              disabled={showAddActForm}
            >
              Create First Act
            </TextButton>
          </div>
        ) : (
          acts.map((act, actIndex) => {
            const actChapters = getChaptersForAct(act.id);
            const { effectiveLanguage: actEffectiveLang, isFallback: actIsFallback } = getActEffectiveLanguage(act);
            const actData = getActData(act, actEffectiveLang);
            const isExpanded = !collapsedItems.has(act.id);

            // Calculate global chapter offset (sum of chapters in previous acts)
            const globalChapterOffset = acts
              .slice(0, actIndex)
              .reduce((sum, prevAct) => sum + getChaptersForAct(prevAct.id).length, 0);

            return (
              <div key={act.id} className={`timeline-act-group ${isExpanded ? 'is-expanded' : 'is-collapsed'}`}>
                
                {/* Act Node */}
                <div className="timeline-act-node">
                  <div className="node-marker">
                    <span className="act-index">{actIndex + 1}</span>
                  </div>
                  
                  <div className="node-content act-content-wrapper">
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
                          <div className="card-title-section" onClick={() => toggleItemExpand(act.id)}>
                            <div className="title-row">
                              <h3>{actData.name}</h3>
                              {actIsFallback && <span className="fallback-badge" title="Translation missing"><Warning size="xs" /></span>}
                            </div>
                            <span className="card-meta">{actChapters.length} Chapters</span>
                          </div>
                        )}

                        {editingAct !== act.id && (
                          <div className="card-actions">
                            <IconButton
                              icon={isExpanded ? <Collapse size="sm" /> : <Expand size="sm" />}
                              onClick={() => toggleItemExpand(act.id)}
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
                        <div className={`card-body-wrapper ${isExpanded ? 'is-expanded' : ''}`}>
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
                                <DropdownItem icon={<Books size="sm" />} label="History" onClick={() => setShowActVersionHistory(act.id)} />
                                <DropdownDivider />
                                <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => handleDeleteAct(act.id)} variant="danger" />
                              </DropdownMenu>
                              <TextButton
                                size="sm"
                                variant="secondary"
                                iconLeft={<Edit size="xs"/>}
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

                {/* Chapter Stream with height animation */}
                <div className="chapter-stream-wrapper">
                  <div className="timeline-chapter-stream" key={`${act.id}-${expandCount[act.id] || 0}`}>
                    <div className="stream-line"></div>

                    {actChapters.map((chapter, chapterIndex) => {
                      const { effectiveLanguage: chLang, isFallback: chFallback } = getChapterEffectiveLanguage(chapter);
                      const chData = getChapterData(chapter, chLang);

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
                                      <span className="chapter-index">CH {globalChapterOffset + chapterIndex + 1}</span>
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
                                (() => {
                                  const isChapterExpanded = expandedChapters.has(chapter.id);
                                  return (
                                    <>
                                      <div className="chapter-header">
                                        <div className="chapter-info" onClick={() => toggleChapterExpand(chapter.id)}>
                                          <span className="chapter-index">CH {globalChapterOffset + chapterIndex + 1}</span>
                                          <h4>{chData.name}</h4>
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
                                              <DropdownItem icon={<Books size="sm" />} label="History" onClick={() => setShowChapterVersionHistory(chapter.id)} />
                                              <DropdownDivider />
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
                                  );
                                })()
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                    {/* Add Chapter Form or Button at the end */}
                    {showAddChapterForm === act.id ? (
                      <div className="timeline-chapter-node creation-node">
                        <div className="chapter-marker creation-marker"><Plus size="xs"/></div>
                        <div className="chapter-content-wrapper">
                          <AddChapterForm
                            actId={act.id}
                            onAdd={handleAddChapter}
                            onCancel={() => setShowAddChapterForm(null)}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="timeline-chapter-node add-chapter-node" onClick={() => setShowAddChapterForm(act.id)}>
                        <div className="chapter-marker add-marker"><Plus size="xs"/></div>
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
          })
        )}
      </div>

      {/* Act AI Edit Modal */}
      {showActAIModal && (
        <AIEditModal
          isOpen={!!showActAIModal}
          onClose={() => setShowActAIModal(null)}
          category="act"
          projectId={projectId || ''}
          targetId={showActAIModal}
          onResult={handleActAIResult}
        />
      )}

      {/* Chapter AI Edit Modal */}
      {showChapterAIModal && (
        <AIEditModal
          isOpen={!!showChapterAIModal}
          onClose={() => setShowChapterAIModal(null)}
          category="chapter"
          projectId={projectId || ''}
          targetId={showChapterAIModal}
          onResult={handleChapterAIResult}
        />
      )}

      {/* Act Version History Modal */}
      {showActVersionHistory && (
        <ActVersionHistoryModal
          isOpen={!!showActVersionHistory}
          onClose={() => setShowActVersionHistory(null)}
          actId={showActVersionHistory}
          onRestoreVersion={handleRestoreActVersion}
          globalDisplayLanguage={globalDisplayLanguage}
        />
      )}

      {/* Chapter Version History Modal */}
      {showChapterVersionHistory && (
        <ChapterVersionHistoryModal
          isOpen={!!showChapterVersionHistory}
          onClose={() => setShowChapterVersionHistory(null)}
          chapterId={showChapterVersionHistory}
          onRestoreVersion={handleRestoreChapterVersion}
          globalDisplayLanguage={globalDisplayLanguage}
        />
      )}

      {/* Act Translation Modal */}
      {showActRetranslateModal && projectId && (
        <TranslationModal
          isOpen={!!showActRetranslateModal}
          onClose={() => setShowActRetranslateModal(null)}
          projectId={projectId}
          onComplete={() => setShowActRetranslateModal(null)}
          allowedObjectTypes={['act']}
          preSelectedObjectIds={[showActRetranslateModal]}
          defaultSourceLanguage={settings.settings.mainLanguage}
          defaultTargetLanguage={globalDisplayLanguage}
        />
      )}

      {/* Chapter Translation Modal */}
      {showChapterRetranslateModal && projectId && (
        <TranslationModal
          isOpen={!!showChapterRetranslateModal}
          onClose={() => setShowChapterRetranslateModal(null)}
          projectId={projectId}
          onComplete={() => setShowChapterRetranslateModal(null)}
          allowedObjectTypes={['chapter']}
          preSelectedObjectIds={[showChapterRetranslateModal]}
          defaultSourceLanguage={settings.settings.mainLanguage}
          defaultTargetLanguage={globalDisplayLanguage}
        />
      )}
    </div>
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
      <h3>Add New Act</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="add-act-name">Act Title</label>
          <input
            id="add-act-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter the title of the act"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="add-act-description">Act Description</label>
          <textarea
            id="add-act-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the main events that happen in this act"
            rows={4}
          />
        </div>
        <div className="form-actions">
          <TextButton variant="ghost" type="button" onClick={onCancel}>
            Cancel
          </TextButton>
          <TextButton variant="secondary" type="submit">
            Add
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
  actId: string;
  onAdd: (actId: string, name: string, description: string) => void;
  onCancel: () => void;
}

const AddChapterForm: React.FC<AddChapterFormProps> = ({ actId, onAdd, onCancel }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onAdd(actId, name, description);
    setName('');
    setDescription('');
  };

  return (
    <div className="item-form add-form chapter-form">
      <h4>Add New Chapter</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="add-chapter-name">Chapter Title</label>
          <input
            id="add-chapter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter the title of the chapter"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="add-chapter-description">Chapter Description</label>
          <textarea
            id="add-chapter-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what happens in this chapter"
            rows={3}
          />
        </div>
        <div className="form-actions">
          <TextButton variant="ghost" type="button" onClick={onCancel}>
            Cancel
          </TextButton>
          <TextButton variant="secondary" type="submit">
            Add
          </TextButton>
        </div>
      </form>
    </div>
  );
};

// ============================================================================
// ACT VERSION HISTORY MODAL
// ============================================================================

interface ActVersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  actId: string;
  onRestoreVersion: (versionId: string) => void;
  globalDisplayLanguage: string;
}

const ActVersionHistoryModal: React.FC<ActVersionHistoryModalProps> = ({
  isOpen,
  onClose,
  actId,
  onRestoreVersion,
  globalDisplayLanguage,
}) => {
  const store = useUnifiedObjectStore();
  const [versions, setVersions] = useState<any[]>([]);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadVersions = async () => {
      if (!isOpen || !actId) return;

      setLoading(true);
      try {
        const versionHistory = await store.getVersions('act', actId);
        setVersions(versionHistory.sort((a, b) => b.number - a.number));
      } catch (error) {
        console.error('Failed to load versions:', error);
      } finally {
        setLoading(false);
      }
    };

    loadVersions();
  }, [isOpen, actId]);

  const act = store.objects[actId] as ActObject;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content version-history-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Act "{(act?.data ? (act.data[globalDisplayLanguage]?.name || act.data[Object.keys(act.data)[0]]?.name) : 'Unknown Act') || 'Unknown Act'}" Version History</h2>
          <button className="modal-close" onClick={onClose}>Close</button>
        </div>

        <div className="version-history-content">
          {loading ? (
            <div className="loading-state">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="empty-state">
              <p>No saved versions.</p>
            </div>
          ) : (
            <div className="versions-list">
              {versions.map((version) => {
                const isCurrentVersion = act?.version.id === version.id;
                // Use globalDisplayLanguage with fallback to available languages
                const availableLanguages = act?.data ? Object.keys(act.data) : [];
                const effectiveLanguage = availableLanguages.includes(globalDisplayLanguage)
                  ? globalDisplayLanguage
                  : (availableLanguages[0] || 'en');
                const versionData = version.data[effectiveLanguage] || {};

                return (
                  <div
                    key={version.id}
                    className={`version-item ${isCurrentVersion ? 'active' : ''}`}
                  >
                    <div className="version-header">
                      <div className="version-info">
                        <div className="version-title">
                          <span className="version-number">Version #{version.number}</span>
                          {isCurrentVersion && <span className="active-badge">Currently Active</span>}
                        </div>
                        <div className="version-metadata">
                          <span className="version-timestamp">
                            {new Date(version.created_at).toLocaleString()}
                          </span>
                          <span className="version-request">
                            Request: {version.user_request || 'N/A'}
                          </span>
                        </div>
                      </div>

                      <div className="version-actions">
                        <TextButton
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const newExpanded = new Set(expandedVersions);
                            if (newExpanded.has(version.id)) {
                              newExpanded.delete(version.id);
                            } else {
                              newExpanded.add(version.id);
                            }
                            setExpandedVersions(newExpanded);
                          }}
                        >
                          {expandedVersions.has(version.id) ? 'Hide details' : 'Show details'}
                        </TextButton>

                        {!isCurrentVersion && (
                          <TextButton
                            variant="secondary"
                            size="sm"
                            onClick={() => onRestoreVersion(version.id)}
                          >
                            Restore
                          </TextButton>
                        )}
                      </div>
                    </div>

                    {expandedVersions.has(version.id) && (
                      <div className="version-content">
                        <h4>Version Data:</h4>
                        <div className="version-data">
                          <div className="version-data-formatted">
                            <div className="data-field">
                              <label>Name:</label>
                              <span>{versionData.name || 'Not set'}</span>
                            </div>
                            <div className="data-field">
                              <label>Description:</label>
                              <span className="description-text">{versionData.description || 'Not set'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <TextButton variant="secondary" onClick={onClose}>
            Close
          </TextButton>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// CHAPTER VERSION HISTORY MODAL
// ============================================================================

interface ChapterVersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  chapterId: string;
  onRestoreVersion: (versionId: string) => void;
  globalDisplayLanguage: string;
}

const ChapterVersionHistoryModal: React.FC<ChapterVersionHistoryModalProps> = ({
  isOpen,
  onClose,
  chapterId,
  onRestoreVersion,
  globalDisplayLanguage,
}) => {
  const store = useUnifiedObjectStore();
  const [versions, setVersions] = useState<any[]>([]);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadVersions = async () => {
      if (!isOpen || !chapterId) return;

      setLoading(true);
      try {
        const versionHistory = await store.getVersions('chapter', chapterId);
        setVersions(versionHistory.sort((a, b) => b.number - a.number));
      } catch (error) {
        console.error('Failed to load versions:', error);
      } finally {
        setLoading(false);
      }
    };

    loadVersions();
  }, [isOpen, chapterId]);

  const chapter = store.objects[chapterId] as ChapterObject;

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content version-history-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Chapter "{(chapter?.data ? (chapter.data[globalDisplayLanguage]?.name || chapter.data[Object.keys(chapter.data)[0]]?.name) : 'Unknown Chapter') || 'Unknown Chapter'}" Version History</h2>
          <button className="modal-close" onClick={onClose}>Close</button>
        </div>

        <div className="version-history-content">
          {loading ? (
            <div className="loading-state">Loading versions...</div>
          ) : versions.length === 0 ? (
            <div className="empty-state">
              <p>No saved versions.</p>
            </div>
          ) : (
            <div className="versions-list">
              {versions.map((version) => {
                const isCurrentVersion = chapter?.version.id === version.id;
                // Use globalDisplayLanguage with fallback to available languages
                const availableLanguages = chapter?.data ? Object.keys(chapter.data) : [];
                const effectiveLanguage = availableLanguages.includes(globalDisplayLanguage)
                  ? globalDisplayLanguage
                  : (availableLanguages[0] || 'en');
                const versionData = version.data[effectiveLanguage] || {};

                return (
                  <div
                    key={version.id}
                    className={`version-item ${isCurrentVersion ? 'active' : ''}`}
                  >
                    <div className="version-header">
                      <div className="version-info">
                        <div className="version-title">
                          <span className="version-number">Version #{version.number}</span>
                          {isCurrentVersion && <span className="active-badge">Currently Active</span>}
                        </div>
                        <div className="version-metadata">
                          <span className="version-timestamp">
                            {new Date(version.created_at).toLocaleString()}
                          </span>
                          <span className="version-request">
                            Request: {version.user_request || 'N/A'}
                          </span>
                        </div>
                      </div>

                      <div className="version-actions">
                        <TextButton
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const newExpanded = new Set(expandedVersions);
                            if (newExpanded.has(version.id)) {
                              newExpanded.delete(version.id);
                            } else {
                              newExpanded.add(version.id);
                            }
                            setExpandedVersions(newExpanded);
                          }}
                        >
                          {expandedVersions.has(version.id) ? 'Hide details' : 'Show details'}
                        </TextButton>

                        {!isCurrentVersion && (
                          <TextButton
                            variant="secondary"
                            size="sm"
                            onClick={() => onRestoreVersion(version.id)}
                          >
                            Restore
                          </TextButton>
                        )}
                      </div>
                    </div>

                    {expandedVersions.has(version.id) && (
                      <div className="version-content">
                        <h4>Version Data:</h4>
                        <div className="version-data">
                          <div className="version-data-formatted">
                            <div className="data-field">
                              <label>Name:</label>
                              <span>{versionData.name || 'Not set'}</span>
                            </div>
                            <div className="data-field">
                              <label>Description:</label>
                              <span className="description-text">{versionData.description || 'Not set'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <TextButton variant="secondary" onClick={onClose}>
            Close
          </TextButton>
        </div>
      </div>
    </div>
  );
};

export default OutlineManager;

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import AIEditModal from './AIEditModal';
import TranslationModal from './TranslationModal';
import { DropdownMenu, DropdownItem, DropdownDivider, DropdownSection } from './ui/DropdownMenu';
import { IconButton } from './IconButton';
import { TextButton } from './TextButton';
import { Expand, Collapse, Plus, Edit, Trash, Refresh, AIAssist, Books, MoreHorizontal } from './icons';
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
  const [showAddActForm, setShowAddActForm] = useState(false);
  const [showAddChapterForm, setShowAddChapterForm] = useState<string | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showActAIModal, setShowActAIModal] = useState<string | null>(null);
  const [showChapterAIModal, setShowChapterAIModal] = useState<string | null>(null);
  const [showActVersionHistory, setShowActVersionHistory] = useState<string | null>(null);
  const [showChapterVersionHistory, setShowChapterVersionHistory] = useState<string | null>(null);
  const [showActRetranslateModal, setShowActRetranslateModal] = useState<string | null>(null);
  const [showChapterRetranslateModal, setShowChapterRetranslateModal] = useState<string | null>(null);

  // Collapse/expand state - empty Set means all collapsed (default)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Toggle single item expand/collapse
  const toggleItemExpand = (itemId: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
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

  // Check if all items are collapsed
  const allCollapsed = expandedItems.size === 0;

  // Toggle function: expand all if collapsed, otherwise collapse all
  const toggleAllCards = () => {
    if (allCollapsed) {
      const allIds = new Set<string>();
      acts.forEach(act => {
        allIds.add(act.id);
        getChaptersForAct(act.id).forEach(chapter => allIds.add(chapter.id));
      });
      setExpandedItems(allIds);
    } else {
      setExpandedItems(new Set());
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

  const handleUpdateAct = async (actId: string, name: string, description: string) => {
    if (!name.trim()) return;

    const act = store.objects[actId] as ActObject;
    if (!act) return;

    const { effectiveLanguage } = getActEffectiveLanguage(act);

    try {
      await store.updateObject('act', actId, {
        data: { name: name.trim(), description: description.trim() },
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

  const handleUpdateChapter = async (chapterId: string, name: string, description: string) => {
    if (!name.trim()) return;

    const chapter = store.objects[chapterId] as ChapterObject;
    if (!chapter) return;

    const { effectiveLanguage } = getChapterEffectiveLanguage(chapter);

    try {
      await store.updateObject('chapter', chapterId, {
        data: { name: name.trim(), description: description.trim() },
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

  const handleAIResult = async (_result?: any) => {
    if (!projectId) return;

    // TODO: Implement full outline AI edit
    // This would need to handle creating/updating multiple acts and chapters
    console.warn('Full outline AI edit not yet implemented for unified system');
  };

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
            className="desktop-only"
          >
            {allCollapsed ? "Expand" : "Collapse"}
          </TextButton>
          <TextButton
            variant="primary"
            size="sm"
            onClick={() => setShowAIModal(true)}
            iconLeft={<AIAssist size="sm" />}
            className="desktop-only"
          >
            AI Edit
          </TextButton>
          <TextButton
            variant="secondary"
            size="sm"
            onClick={() => setShowAddActForm(true)}
            disabled={showAddActForm}
            className="desktop-only"
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
              icon={<AIAssist size="sm" />}
              label="AI Edit"
              onClick={() => setShowAIModal(true)}
            />
            <DropdownItem
              icon={<Plus size="sm" />}
              label="Add Act"
              onClick={() => setShowAddActForm(true)}
              disabled={showAddActForm}
            />
          </DropdownMenu>
        </div>
      </div>

      {showAddActForm && (
        <AddActForm
          onAdd={handleAddAct}
          onCancel={() => setShowAddActForm(false)}
        />
      )}

      <div className="acts-list">
        {acts.length === 0 ? (
          <div className="empty-state">
            <p>No acts have been created yet.</p>
            <p>Add a new act to build your story structure!</p>
          </div>
        ) : (
          acts.map((act, actIndex) => {
            const actChapters = getChaptersForAct(act.id);
            const { effectiveLanguage: actEffectiveLang, isFallback: actIsFallback } = getActEffectiveLanguage(act);
            const actData = getActData(act, actEffectiveLang);

            return (
              <div key={act.id} className="act-card">
                <div className="act-header">
                  <div className="act-title">
                    <IconButton
                      icon={expandedItems.has(act.id) ? <Collapse size="xs" /> : <Expand size="xs" />}
                      onClick={() => toggleItemExpand(act.id)}
                      title={expandedItems.has(act.id) ? 'Collapse' : 'Expand'}
                      size="xs"
                      className="collapse-toggle"
                    />
                    <span className="act-number">Act {actIndex + 1}</span>
                    <h3 onClick={() => toggleItemExpand(act.id)} className="item-name-clickable">{actData.name}</h3>
                    {actIsFallback && <span className="fallback-warning" title={`${globalDisplayLanguage} not available`}><Warning size="sm" /></span>}
                  </div>
                  <div className="card-actions">
                    <TextButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditingAct(act.id)}
                      disabled={!!store.loading[act.id]}
                      className="desktop-only"
                    >
                      Edit
                    </TextButton>
                    <TextButton
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowAddChapterForm(act.id)}
                      disabled={showAddChapterForm === act.id}
                      className="desktop-only"
                    >
                      + Chapter
                    </TextButton>
                    <DropdownMenu
                      trigger={
                        <IconButton
                          icon={<MoreHorizontal size="sm" />}
                          disabled={!!store.loading[act.id]}
                          title="More actions"
                          size="sm"
                        />
                      }
                    >
                      <DropdownSection>
                        <DropdownItem
                          icon={<Edit size="sm" />}
                          label="Edit"
                          onClick={() => setEditingAct(act.id)}
                          disabled={!!store.loading[act.id]}
                          className="mobile-only"
                        />
                        <DropdownItem
                          icon={<Plus size="sm" />}
                          label="Add Chapter"
                          onClick={() => setShowAddChapterForm(act.id)}
                          disabled={showAddChapterForm === act.id}
                          className="mobile-only"
                        />
                        <DropdownDivider className="mobile-only" />
                        {settings.settings.defaultSubLanguage &&
                          Object.keys(act.data).includes(settings.settings.defaultSubLanguage) && (
                            <DropdownItem
                              icon={<Refresh size="sm" />}
                              label="Retranslate"
                              onClick={() => setShowActRetranslateModal(act.id)}
                              disabled={!!store.loading[act.id]}
                            />
                        )}
                        <DropdownItem
                          icon={<Books size="sm" />}
                          label="History"
                          onClick={() => setShowActVersionHistory(act.id)}
                          disabled={!!store.loading[act.id]}
                        />
                      </DropdownSection>
                      <DropdownSection>
                        <DropdownItem
                          icon={<Trash size="sm" />}
                          label="Delete"
                          onClick={() => handleDeleteAct(act.id)}
                          variant="danger"
                          disabled={!!store.loading[act.id]}
                        />
                      </DropdownSection>
                    </DropdownMenu>
                  </div>
                </div>

                {editingAct === act.id ? (
                  <EditActForm
                    actData={actData}
                    onUpdate={(name, description) => handleUpdateAct(act.id, name, description)}
                    onCancel={() => setEditingAct(null)}
                    onAIEdit={() => setShowActAIModal(act.id)}
                  />
                ) : expandedItems.has(act.id) && (
                  <div className="act-content">
                    <p className="act-description">
                      {actData.description || 'No description.'}
                    </p>
                  </div>
                )}

                {expandedItems.has(act.id) && showAddChapterForm === act.id && (
                  <AddChapterForm
                    actId={act.id}
                    onAdd={handleAddChapter}
                    onCancel={() => setShowAddChapterForm(null)}
                  />
                )}

                {expandedItems.has(act.id) && <div className="chapters-list">
                  {actChapters.map((chapter, chapterIndex) => {
                    const { effectiveLanguage: chapterEffectiveLang, isFallback: chapterIsFallback } = getChapterEffectiveLanguage(chapter);
                    const chapterData = getChapterData(chapter, chapterEffectiveLang);
                    return (
                    <div key={chapter.id} className="chapter-card">
                      <div className="chapter-header">
                        <div className="chapter-title">
                          <IconButton
                            icon={expandedItems.has(chapter.id) ? <Collapse size="xs" /> : <Expand size="xs" />}
                            onClick={() => toggleItemExpand(chapter.id)}
                            title={expandedItems.has(chapter.id) ? 'Collapse' : 'Expand'}
                            size="xs"
                            className="collapse-toggle"
                          />
                          <span className="chapter-number">
                            Chapter {chapterIndex + 1}
                          </span>
                          <h4 onClick={() => toggleItemExpand(chapter.id)} className="item-name-clickable">{chapterData.name}</h4>
                          {chapterIsFallback && <span className="fallback-warning" title={`${globalDisplayLanguage} not available`}><Warning size="sm" /></span>}
                        </div>
                        <div className="card-actions">
                          <TextButton
                            variant="secondary"
                            size="sm"
                            onClick={() => setEditingChapter(chapter.id)}
                            disabled={!!store.loading[chapter.id]}
                            className="desktop-only"
                          >
                            Edit
                          </TextButton>
                          <DropdownMenu
                            trigger={
                              <IconButton
                                icon={<MoreHorizontal size="sm" />}
                                disabled={!!store.loading[chapter.id]}
                                title="More actions"
                                size="sm"
                              />
                            }
                          >
                            <DropdownSection>
                              <DropdownItem
                                icon={<Edit size="sm" />}
                                label="Edit"
                                onClick={() => setEditingChapter(chapter.id)}
                                disabled={!!store.loading[chapter.id]}
                                className="mobile-only"
                              />
                              {settings.settings.defaultSubLanguage &&
                                Object.keys(chapter.data).includes(settings.settings.defaultSubLanguage) && (
                                  <DropdownItem
                                    icon={<Refresh size="sm" />}
                                    label="Retranslate"
                                    onClick={() => setShowChapterRetranslateModal(chapter.id)}
                                    disabled={!!store.loading[chapter.id]}
                                  />
                              )}
                              <DropdownItem
                                icon={<Books size="sm" />}
                                label="History"
                                onClick={() => setShowChapterVersionHistory(chapter.id)}
                                disabled={!!store.loading[chapter.id]}
                              />
                            </DropdownSection>
                            <DropdownSection>
                              <DropdownItem
                                icon={<Trash size="sm" />}
                                label="Delete"
                                onClick={() => handleDeleteChapter(chapter.id)}
                                variant="danger"
                                disabled={!!store.loading[chapter.id]}
                              />
                            </DropdownSection>
                          </DropdownMenu>
                        </div>
                      </div>

                      {editingChapter === chapter.id ? (
                        <EditChapterForm
                          chapterData={chapterData}
                          onUpdate={(name, description) => handleUpdateChapter(chapter.id, name, description)}
                          onCancel={() => setEditingChapter(null)}
                          onAIEdit={() => setShowChapterAIModal(chapter.id)}
                        />
                      ) : expandedItems.has(chapter.id) && (
                        <div className="chapter-content">
                          <p className="chapter-description">
                            {chapterData.description || 'No description.'}
                          </p>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>}
              </div>
            );
          })
        )}
      </div>

      <AIEditModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        category="act"
        projectId={projectId || ''}
        targetId={''} // Outline-level edit
        onResult={handleAIResult}
      />

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
          <TextButton variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </TextButton>
          <TextButton variant="primary" type="submit">
            Add
          </TextButton>
        </div>
      </form>
    </div>
  );
};

// ============================================================================
// EDIT ACT FORM
// ============================================================================

interface EditActFormProps {
  actData: { name: string; description: string };
  onUpdate: (name: string, description: string) => void;
  onCancel: () => void;
  onAIEdit: () => void;
}

const EditActForm: React.FC<EditActFormProps> = ({ actData, onUpdate, onCancel, onAIEdit }) => {
  const [name, setName] = useState(actData.name);
  const [description, setDescription] = useState(actData.description);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(name, description);
  };

  return (
    <div className="item-form edit-form">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="edit-act-name">Act Title</label>
          <input
            id="edit-act-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter the title of the act"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="edit-act-description">Act Description</label>
          <textarea
            id="edit-act-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the main events that happen in this act"
            rows={4}
          />
        </div>
        <div className="form-actions-split">
          <TextButton variant="primary" size="sm" type="button" onClick={onAIEdit} iconLeft={<AIAssist size="sm" />}>
            AI Edit
          </TextButton>
          <div className="form-actions-right">
            <TextButton variant="secondary" type="button" onClick={onCancel}>
              Cancel
            </TextButton>
            <TextButton variant="primary" type="submit">
              Save
            </TextButton>
          </div>
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
          <TextButton variant="secondary" type="button" onClick={onCancel}>
            Cancel
          </TextButton>
          <TextButton variant="primary" type="submit">
            Add
          </TextButton>
        </div>
      </form>
    </div>
  );
};

// ============================================================================
// EDIT CHAPTER FORM
// ============================================================================

interface EditChapterFormProps {
  chapterData: { name: string; description: string };
  onUpdate: (name: string, description: string) => void;
  onCancel: () => void;
  onAIEdit: () => void;
}

const EditChapterForm: React.FC<EditChapterFormProps> = ({ chapterData, onUpdate, onCancel, onAIEdit }) => {
  const [name, setName] = useState(chapterData.name);
  const [description, setDescription] = useState(chapterData.description);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(name, description);
  };

  return (
    <div className="item-form edit-form chapter-form">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="edit-chapter-name">Chapter Title</label>
          <input
            id="edit-chapter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter the title of the chapter"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="edit-chapter-description">Chapter Description</label>
          <textarea
            id="edit-chapter-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what happens in this chapter"
            rows={3}
          />
        </div>
        <div className="form-actions-split">
          <TextButton variant="primary" size="sm" type="button" onClick={onAIEdit} iconLeft={<AIAssist size="sm" />}>
            AI Edit
          </TextButton>
          <div className="form-actions-right">
            <TextButton variant="secondary" type="button" onClick={onCancel}>
              Cancel
            </TextButton>
            <TextButton variant="primary" type="submit">
              Save
            </TextButton>
          </div>
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

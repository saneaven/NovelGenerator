import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import AIEditModal from './AIEditModal';
import RetranslateModal from './RetranslateModal';
import { LanguageSwitcher } from './LanguageSwitcher';
import { TranslationService } from '../services/translationService';
import type { ActObject, ChapterObject, ActData, ChapterData } from '../types/unifiedObject';

const OutlineManager: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const store = useUnifiedObjectStore();
  const listObjects = useUnifiedObjectStore(state => state.listObjects);
  const settings = useSettingsStore();

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

  // ========================================================================
  // ACT HANDLERS
  // ========================================================================

  const handleAddAct = async (name: string, description: string) => {
    if (!projectId || !name.trim()) return;

    try {
      const actOrder = acts.length;
      const newAct = await store.createObject(
        'act',
        projectId,
        { name: name.trim(), description: description.trim() },
        settings.primaryLanguage,
        { order: actOrder }
      );
      setShowAddActForm(false);
    } catch (error) {
      console.error('Failed to create act:', error);
      alert('Failed to create act. Please try again.');
    }
  };

  const handleUpdateAct = async (actId: string, name: string, description: string) => {
    if (!name.trim()) return;

    const act = store.objects[actId] as ActObject;
    if (!act) return;

    try {
      await store.updateObject('act', actId, {
        data: { name: name.trim(), description: description.trim() },
        language: act.languages.active,
        create_new_version: true,
        user_request: 'Manual Edit',
      });
      setEditingAct(null);
    } catch (error) {
      console.error('Failed to update act:', error);
      alert('Failed to update act. Please try again.');
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
      alert('Failed to delete act. Please try again.');
    }
  };

  const handleActLanguageChange = async (actId: string, newLanguage: string) => {
    try {
      await store.switchLanguage('act', actId, newLanguage);
    } catch (error) {
      console.error('Failed to switch act language:', error);
      alert('Failed to switch language. Please try again.');
    }
  };

  const handleAddActTranslation = async (actId: string) => {
    if (!projectId) return;

    const act = store.objects[actId] as ActObject;
    if (!act) return;

    const targetLanguage = settings.secondaryLanguage;
    if (!targetLanguage) {
      alert('Please set a secondary language in settings first.');
      return;
    }

    if (act.languages.available.includes(targetLanguage)) {
      // Just switch to it
      await handleActLanguageChange(actId, targetLanguage);
      return;
    }

    try {
      TranslationService.setTranslationStatus(actId, { objectId: actId, isTranslating: true });
      await TranslationService.translateSingle(
        {
          objectType: 'act',
          objectId: actId,
          sourceData: {
            name: act.data.name,
            description: act.data.description,
          },
        },
        {
          projectId,
          sourceLanguage: act.languages.active,
          targetLanguage,
        }
      );

      // Refresh object to update UI with new translation
      await store.fetchObject('act', actId);

      console.log(`✓ Added ${targetLanguage} translation for act`);
      alert(`Translation added for ${targetLanguage}`);
    } catch (error) {
      console.error('Failed to add act translation:', error);
      alert(error instanceof Error ? error.message : 'Failed to add translation. Please try again.');
    } finally {
      TranslationService.clearTranslationStatus(actId);
    }
  };

  const handleRetranslateAct = async (includePrevious: boolean, userInstructions: string) => {
    if (!projectId || !showActRetranslateModal) return;

    const act = store.objects[showActRetranslateModal] as ActObject;
    if (!act) return;

    const targetLanguage = settings.secondaryLanguage;
    if (!targetLanguage) {
      alert('Please set a secondary language in settings first.');
      return;
    }

    try {
      TranslationService.setTranslationStatus(showActRetranslateModal, {
        objectId: showActRetranslateModal,
        isTranslating: true,
      });

      let instructions = userInstructions || '';

      if (includePrevious && act.languages.available.includes(targetLanguage)) {
        const prevTranslation = `Previous translation for reference:\n${JSON.stringify({
          name: act.data.name,
          description: act.data.description,
        }, null, 2)}`;
        instructions = instructions ? `${instructions}\n\n${prevTranslation}` : prevTranslation;
      }

      await TranslationService.translateSingle(
        {
          objectType: 'act',
          objectId: showActRetranslateModal,
          sourceData: {
            name: act.data.name,
            description: act.data.description,
          },
        },
        {
          projectId,
          sourceLanguage: act.languages.active,
          targetLanguage,
          userInstructions: instructions || undefined,
        }
      );

      // Refresh object to update UI with new translation
      await store.fetchObject('act', showActRetranslateModal);

      console.log(`✓ Retranslated act to ${targetLanguage}`);
      alert(`Retranslation complete for ${targetLanguage}`);
      setShowActRetranslateModal(null);
    } catch (error) {
      console.error('Failed to retranslate act:', error);
      alert(error instanceof Error ? error.message : 'Failed to retranslate. Please try again.');
    } finally {
      TranslationService.clearTranslationStatus(showActRetranslateModal);
    }
  };

  // ========================================================================
  // CHAPTER HANDLERS
  // ========================================================================

  const handleAddChapter = async (actId: string, name: string, description: string) => {
    if (!projectId || !name.trim()) return;

    try {
      const chapterOrder = getChaptersForAct(actId).length;
      const newChapter = await store.createObject(
        'chapter',
        projectId,
        { name: name.trim(), description: description.trim() },
        settings.primaryLanguage,
        {
          act_id: actId,
          order: chapterOrder
        }
      );
      setShowAddChapterForm(null);
    } catch (error) {
      console.error('Failed to create chapter:', error);
      alert('Failed to create chapter. Please try again.');
    }
  };

  const handleUpdateChapter = async (chapterId: string, name: string, description: string) => {
    if (!name.trim()) return;

    const chapter = store.objects[chapterId] as ChapterObject;
    if (!chapter) return;

    try {
      await store.updateObject('chapter', chapterId, {
        data: { name: name.trim(), description: description.trim() },
        language: chapter.languages.active,
        create_new_version: true,
        user_request: 'Manual Edit',
      });
      setEditingChapter(null);
    } catch (error) {
      console.error('Failed to update chapter:', error);
      alert('Failed to update chapter. Please try again.');
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
      alert('Failed to delete chapter. Please try again.');
    }
  };

  const handleChapterLanguageChange = async (chapterId: string, newLanguage: string) => {
    try {
      await store.switchLanguage('chapter', chapterId, newLanguage);
    } catch (error) {
      console.error('Failed to switch chapter language:', error);
      alert('Failed to switch language. Please try again.');
    }
  };

  const handleAddChapterTranslation = async (chapterId: string) => {
    if (!projectId) return;

    const chapter = store.objects[chapterId] as ChapterObject;
    if (!chapter) return;

    const targetLanguage = settings.secondaryLanguage;
    if (!targetLanguage) {
      alert('Please set a secondary language in settings first.');
      return;
    }

    if (chapter.languages.available.includes(targetLanguage)) {
      // Just switch to it
      await handleChapterLanguageChange(chapterId, targetLanguage);
      return;
    }

    try {
      TranslationService.setTranslationStatus(chapterId, { objectId: chapterId, isTranslating: true });
      await TranslationService.translateSingle(
        {
          objectType: 'chapter',
          objectId: chapterId,
          sourceData: {
            name: chapter.data.name,
            description: chapter.data.description,
          },
        },
        {
          projectId,
          sourceLanguage: chapter.languages.active,
          targetLanguage,
        }
      );

      // Refresh object to update UI with new translation
      await store.fetchObject('chapter', chapterId);

      console.log(`✓ Added ${targetLanguage} translation for chapter`);
      alert(`Translation added for ${targetLanguage}`);
    } catch (error) {
      console.error('Failed to add chapter translation:', error);
      alert(error instanceof Error ? error.message : 'Failed to add translation. Please try again.');
    } finally {
      TranslationService.clearTranslationStatus(chapterId);
    }
  };

  const handleRetranslateChapter = async (includePrevious: boolean, userInstructions: string) => {
    if (!projectId || !showChapterRetranslateModal) return;

    const chapter = store.objects[showChapterRetranslateModal] as ChapterObject;
    if (!chapter) return;

    const targetLanguage = settings.secondaryLanguage;
    if (!targetLanguage) {
      alert('Please set a secondary language in settings first.');
      return;
    }

    try {
      TranslationService.setTranslationStatus(showChapterRetranslateModal, {
        objectId: showChapterRetranslateModal,
        isTranslating: true,
      });

      let instructions = userInstructions || '';

      if (includePrevious && chapter.languages.available.includes(targetLanguage)) {
        const prevTranslation = `Previous translation for reference:\n${JSON.stringify({
          name: chapter.data.name,
          description: chapter.data.description,
        }, null, 2)}`;
        instructions = instructions ? `${instructions}\n\n${prevTranslation}` : prevTranslation;
      }

      await TranslationService.translateSingle(
        {
          objectType: 'chapter',
          objectId: showChapterRetranslateModal,
          sourceData: {
            name: chapter.data.name,
            description: chapter.data.description,
          },
        },
        {
          projectId,
          sourceLanguage: chapter.languages.active,
          targetLanguage,
          userInstructions: instructions || undefined,
        }
      );

      // Refresh object to update UI with new translation
      await store.fetchObject('chapter', showChapterRetranslateModal);

      console.log(`✓ Retranslated chapter to ${targetLanguage}`);
      alert(`Retranslation complete for ${targetLanguage}`);
      setShowChapterRetranslateModal(null);
    } catch (error) {
      console.error('Failed to retranslate chapter:', error);
      alert(error instanceof Error ? error.message : 'Failed to retranslate. Please try again.');
    } finally {
      TranslationService.clearTranslationStatus(showChapterRetranslateModal);
    }
  };

  // ========================================================================
  // AI & VERSION HISTORY HANDLERS
  // ========================================================================

  const handleAIResult = async (result: any) => {
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
      try {
        await store.updateObject('act', showActAIModal, {
          data: { name: result.name, description: result.description },
          language: act.languages.active,
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
      try {
        await store.updateObject('chapter', showChapterAIModal, {
          data: { name: result.name, description: result.description },
          language: chapter.languages.active,
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
      await store.activateVersion('act', showActVersionHistory, versionId);
      setShowActVersionHistory(null);
    } catch (error) {
      console.error('Failed to restore version:', error);
      alert('Failed to restore version. Please try again.');
    }
  };

  const handleRestoreChapterVersion = async (versionId: string) => {
    if (!showChapterVersionHistory) return;

    try {
      await store.activateVersion('chapter', showChapterVersionHistory, versionId);
      setShowChapterVersionHistory(null);
    } catch (error) {
      console.error('Failed to restore version:', error);
      alert('Failed to restore version. Please try again.');
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
          <button
            onClick={() => setShowAIModal(true)}
            className="ai-edit-button"
          >
            AI Edit
          </button>
          <button
            onClick={() => setShowAddActForm(true)}
            className="add-button"
            disabled={showAddActForm}
          >
            Add Act
          </button>
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

            return (
              <div key={act.id} className="act-card">
                <div className="act-header">
                  <div className="act-title">
                    <span className="act-number">Act {actIndex + 1}</span>
                    <h3>{act.data.name}</h3>
                    <LanguageSwitcher
                      object={act}
                      onLanguageChange={(lang) => handleActLanguageChange(act.id, lang)}
                      disabled={!!store.loading[act.id]}
                      showLabel={false}
                    />
                  </div>
                  <div className="act-actions">
                    {settings.secondaryLanguage && (
                      act.languages.available.includes(settings.secondaryLanguage) ? (
                        <button
                          onClick={() => setShowActRetranslateModal(act.id)}
                          className="translate-button retranslate"
                          disabled={!!store.loading[act.id]}
                          title={`Retranslate to ${settings.secondaryLanguage}`}
                        >
                          🔄 Retranslate
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAddActTranslation(act.id)}
                          className="translate-button"
                          disabled={!!store.loading[act.id]}
                          title={`Translate to ${settings.secondaryLanguage}`}
                        >
                          🌐 Add {settings.secondaryLanguage}
                        </button>
                      )
                    )}
                    <button
                      onClick={() => setShowActVersionHistory(act.id)}
                      className="version-history-button"
                    >
                      History
                    </button>
                    <button
                      onClick={() => setShowActAIModal(act.id)}
                      className="ai-edit-button"
                    >
                      AI Edit
                    </button>
                    <button
                      onClick={() => setEditingAct(act.id)}
                      className="edit-button"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setShowAddChapterForm(act.id)}
                      className="add-chapter-button"
                      disabled={showAddChapterForm === act.id}
                    >
                      Add Chapter
                    </button>
                    <button
                      onClick={() => handleDeleteAct(act.id)}
                      className="delete-button"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {editingAct === act.id ? (
                  <EditActForm
                    act={act}
                    onUpdate={(name, description) => handleUpdateAct(act.id, name, description)}
                    onCancel={() => setEditingAct(null)}
                  />
                ) : (
                  <div className="act-content">
                    <p className="act-description">
                      {act.data.description || 'No description.'}
                    </p>
                  </div>
                )}

                {showAddChapterForm === act.id && (
                  <AddChapterForm
                    actId={act.id}
                    onAdd={handleAddChapter}
                    onCancel={() => setShowAddChapterForm(null)}
                  />
                )}

                <div className="chapters-list">
                  {actChapters.map((chapter, chapterIndex) => (
                    <div key={chapter.id} className="chapter-card">
                      <div className="chapter-header">
                        <div className="chapter-title">
                          <span className="chapter-number">
                            Chapter {chapterIndex + 1}
                          </span>
                          <h4>{chapter.data.name}</h4>
                          <LanguageSwitcher
                            object={chapter}
                            onLanguageChange={(lang) => handleChapterLanguageChange(chapter.id, lang)}
                            disabled={!!store.loading[chapter.id]}
                            showLabel={false}
                          />
                        </div>
                        <div className="chapter-actions">
                          {settings.secondaryLanguage && (
                            chapter.languages.available.includes(settings.secondaryLanguage) ? (
                              <button
                                onClick={() => setShowChapterRetranslateModal(chapter.id)}
                                className="translate-button retranslate"
                                disabled={!!store.loading[chapter.id]}
                                title={`Retranslate to ${settings.secondaryLanguage}`}
                              >
                                🔄 Retranslate
                              </button>
                            ) : (
                              <button
                                onClick={() => handleAddChapterTranslation(chapter.id)}
                                className="translate-button"
                                disabled={!!store.loading[chapter.id]}
                                title={`Translate to ${settings.secondaryLanguage}`}
                              >
                                🌐 Add {settings.secondaryLanguage}
                              </button>
                            )
                          )}
                          <button
                            onClick={() => setShowChapterVersionHistory(chapter.id)}
                            className="version-history-button"
                          >
                            History
                          </button>
                          <button
                            onClick={() => setShowChapterAIModal(chapter.id)}
                            className="ai-edit-button"
                          >
                            AI Edit
                          </button>
                          <button
                            onClick={() => setEditingChapter(chapter.id)}
                            className="edit-button"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteChapter(chapter.id)}
                            className="delete-button"
                          >
                            Delete
                          </button>
                        </div>
                      </div>

                      {editingChapter === chapter.id ? (
                        <EditChapterForm
                          chapter={chapter}
                          onUpdate={(name, description) => handleUpdateChapter(chapter.id, name, description)}
                          onCancel={() => setEditingChapter(null)}
                        />
                      ) : (
                        <div className="chapter-content">
                          <p className="chapter-description">
                            {chapter.data.description || 'No description.'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <AIEditModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        category="outline"
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
        />
      )}

      {/* Chapter Version History Modal */}
      {showChapterVersionHistory && (
        <ChapterVersionHistoryModal
          isOpen={!!showChapterVersionHistory}
          onClose={() => setShowChapterVersionHistory(null)}
          chapterId={showChapterVersionHistory}
          onRestoreVersion={handleRestoreChapterVersion}
        />
      )}

      {/* Act Retranslate Modal */}
      {showActRetranslateModal && settings.secondaryLanguage && (
        <RetranslateModal
          isOpen={!!showActRetranslateModal}
          onClose={() => setShowActRetranslateModal(null)}
          sourceLanguage={store.objects[showActRetranslateModal]?.languages?.active || settings.primaryLanguage}
          targetLanguage={settings.secondaryLanguage}
          translationTimestamp={store.objects[showActRetranslateModal]?.version?.created_at || null}
          onRetranslate={handleRetranslateAct}
          isTranslating={store.loading[showActRetranslateModal] || false}
        />
      )}

      {/* Chapter Retranslate Modal */}
      {showChapterRetranslateModal && settings.secondaryLanguage && (
        <RetranslateModal
          isOpen={!!showChapterRetranslateModal}
          onClose={() => setShowChapterRetranslateModal(null)}
          sourceLanguage={store.objects[showChapterRetranslateModal]?.languages?.active || settings.primaryLanguage}
          targetLanguage={settings.secondaryLanguage}
          translationTimestamp={store.objects[showChapterRetranslateModal]?.version?.created_at || null}
          onRetranslate={handleRetranslateChapter}
          isTranslating={store.loading[showChapterRetranslateModal] || false}
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
          <button type="button" onClick={onCancel} className="cancel-button">
            Cancel
          </button>
          <button type="submit" className="save-button">
            Add
          </button>
        </div>
      </form>
    </div>
  );
};

// ============================================================================
// EDIT ACT FORM
// ============================================================================

interface EditActFormProps {
  act: ActObject;
  onUpdate: (name: string, description: string) => void;
  onCancel: () => void;
}

const EditActForm: React.FC<EditActFormProps> = ({ act, onUpdate, onCancel }) => {
  const [name, setName] = useState(act.data.name);
  const [description, setDescription] = useState(act.data.description);

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
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="cancel-button">
            Cancel
          </button>
          <button type="submit" className="save-button">
            Save
          </button>
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
          <button type="button" onClick={onCancel} className="cancel-button">
            Cancel
          </button>
          <button type="submit" className="save-button">
            Add
          </button>
        </div>
      </form>
    </div>
  );
};

// ============================================================================
// EDIT CHAPTER FORM
// ============================================================================

interface EditChapterFormProps {
  chapter: ChapterObject;
  onUpdate: (name: string, description: string) => void;
  onCancel: () => void;
}

const EditChapterForm: React.FC<EditChapterFormProps> = ({ chapter, onUpdate, onCancel }) => {
  const [name, setName] = useState(chapter.data.name);
  const [description, setDescription] = useState(chapter.data.description);

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
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="cancel-button">
            Cancel
          </button>
          <button type="submit" className="save-button">
            Save
          </button>
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
}

const ActVersionHistoryModal: React.FC<ActVersionHistoryModalProps> = ({
  isOpen,
  onClose,
  actId,
  onRestoreVersion,
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
          <h2>Act "{act?.data.name || 'Unknown Act'}" Version History</h2>
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
              {versions.map((version, index) => {
                const isCurrentVersion = act?.version.id === version.id;
                const versionData = version.data[act?.languages.active || 'en'] || {};

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
                        <button
                          onClick={() => {
                            const newExpanded = new Set(expandedVersions);
                            if (newExpanded.has(version.id)) {
                              newExpanded.delete(version.id);
                            } else {
                              newExpanded.add(version.id);
                            }
                            setExpandedVersions(newExpanded);
                          }}
                          className="expand-button"
                        >
                          {expandedVersions.has(version.id) ? 'Hide details' : 'Show details'}
                        </button>

                        {!isCurrentVersion && (
                          <button
                            onClick={() => onRestoreVersion(version.id)}
                            className="restore-button"
                          >
                            Restore
                          </button>
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
          <button onClick={onClose} className="cancel-button">
            Close
          </button>
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
}

const ChapterVersionHistoryModal: React.FC<ChapterVersionHistoryModalProps> = ({
  isOpen,
  onClose,
  chapterId,
  onRestoreVersion,
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
          <h2>Chapter "{chapter?.data.name || 'Unknown Chapter'}" Version History</h2>
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
              {versions.map((version, index) => {
                const isCurrentVersion = chapter?.version.id === version.id;
                const versionData = version.data[chapter?.languages.active || 'en'] || {};

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
                        <button
                          onClick={() => {
                            const newExpanded = new Set(expandedVersions);
                            if (newExpanded.has(version.id)) {
                              newExpanded.delete(version.id);
                            } else {
                              newExpanded.add(version.id);
                            }
                            setExpandedVersions(newExpanded);
                          }}
                          className="expand-button"
                        >
                          {expandedVersions.has(version.id) ? 'Hide details' : 'Show details'}
                        </button>

                        {!isCurrentVersion && (
                          <button
                            onClick={() => onRestoreVersion(version.id)}
                            className="restore-button"
                          >
                            Restore
                          </button>
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
          <button onClick={onClose} className="cancel-button">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default OutlineManager;

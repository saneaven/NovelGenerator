import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useStoryObjectStore } from '../store/storyObjectStore';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import type { Outline, Act, Chapter } from '../types/storyObject';
import { createEmptyOutline } from '../types/storyObject';

const OutlineManager: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const {
    getOutline,
    setOutline,
    updateOutlineAI,
    addAct,
    updateAct,
    deleteAct,
    addChapter,
    updateChapter,
    deleteChapter,
    getActById,
    getChapterById,
    getActVersions,
    getChapterVersions,
  } = useStoryObjectStore();

  const [editingAct, setEditingAct] = useState<Act | null>(null);
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null);
  const [showAddActForm, setShowAddActForm] = useState(false);
  const [showAddChapterForm, setShowAddChapterForm] = useState<string | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showActAIModal, setShowActAIModal] = useState<string | null>(null);
  const [showChapterAIModal, setShowChapterAIModal] = useState<string | null>(null);
  const [showActVersionHistory, setShowActVersionHistory] = useState<string | null>(null);
  const [showChapterVersionHistory, setShowChapterVersionHistory] = useState<string | null>(null);

  // Get outline directly from store - this will automatically re-render when store updates
  const outline = projectId ? getOutline(projectId) : null;

  const handleAddAct = (name: string, description: string) => {
    if (projectId && name.trim()) {
      if (!outline) {
        const newOutline = createEmptyOutline();
        setOutline(projectId, newOutline);
      }
      addAct(projectId, { name: name.trim(), description: description.trim() });
      setShowAddActForm(false);
    }
  };

  const handleUpdateAct = (actId: string, name: string, description: string) => {
    if (projectId && name.trim()) {
      updateAct(projectId, actId, { name: name.trim(), description: description.trim() });
      setEditingAct(null);
    }
  };

  const handleDeleteAct = (actId: string) => {
    if (confirm('Are you sure you want to delete this act? All chapters within it will also be deleted.')) {
      if (projectId) {
        deleteAct(projectId, actId);
      }
    }
  };

  const handleAddChapter = (actId: string, name: string, description: string) => {
    if (projectId && name.trim()) {
      addChapter(projectId, actId, { name: name.trim(), description: description.trim() });
      setShowAddChapterForm(null);
    }
  };

  const handleUpdateChapter = (chapterId: string, name: string, description: string) => {
    if (projectId && name.trim()) {
      updateChapter(projectId, chapterId, { name: name.trim(), description: description.trim() });
      setEditingChapter(null);
    }
  };

  const handleDeleteChapter = (chapterId: string) => {
    if (confirm('Are you sure you want to delete this chapter?')) {
      if (projectId) {
        deleteChapter(projectId, chapterId);
      }
    }
  };

  const handleAIResult = (result: any) => {    
    if (!projectId) return;
    
    if (result && result.acts && Array.isArray(result.acts)) {      const newOutline = createEmptyOutline();
      
      newOutline.acts = result.acts.map((actData: any) => {
        const actId = actData.id || crypto.randomUUID();
        const existingAct = outline?.acts.find(a => a.id === actId);
        
        return {
          id: actId,
          name: actData.name || '',
          description: actData.description || '',
          createdAt: existingAct?.createdAt || new Date(),
          updatedAt: new Date(),
          chapters: (actData.chapters || []).map((chapterData: any) => {
            const chapterId = chapterData.id || crypto.randomUUID();
            const existingChapter = existingAct?.chapters.find(c => c.id === chapterId);
            
            return {
              id: chapterId,
              name: chapterData.name || '',
              description: chapterData.description || '',
              createdAt: existingChapter?.createdAt || new Date(),
              updatedAt: new Date(),
              actId: actId,
            };
          }),
        };
      });
      
      updateOutlineAI(projectId, newOutline);
    }
  };

  const handleActAIResult = (result: any) => {
    if (!projectId) return;

    if (result && result.id && result.name !== undefined && result.description !== undefined) {
      updateAct(projectId, result.id, {
        name: result.name,
        description: result.description
      });
      setShowActAIModal(null);
    }
  };

  const handleChapterAIResult = (result: any) => {
    if (!projectId) return;

    if (result && result.id && result.name !== undefined && result.description !== undefined) {
      updateChapter(projectId, result.id, {
        name: result.name,
        description: result.description
      });
      setShowChapterAIModal(null);
    }
  };


  const handleRestoreActVersion = (versionData: any) => {
    if (!projectId) return;
    
    if (versionData && (versionData.name !== undefined || versionData.description !== undefined)) {
      const actId = showActVersionHistory;
      if (actId) {
        updateAct(projectId, actId, {
          name: versionData.name || '',
          description: versionData.description || ''
        });
        setShowActVersionHistory(null);
      }
    }
  };

  const handleRestoreChapterVersion = (versionData: any) => {
    if (!projectId) return;
    
    if (versionData && (versionData.name !== undefined || versionData.description !== undefined)) {
      const chapterId = showChapterVersionHistory;
      if (chapterId) {
        updateChapter(projectId, chapterId, {
          name: versionData.name || '',
          description: versionData.description || ''
        });
        setShowChapterVersionHistory(null);
      }
    }
  };

  if (!projectId) {
    return (
      <div className="error-container">
        <p>Project ID not found.</p>
      </div>
    );
  }

  const acts = outline?.acts || [];

  return (
    <div className="outline-manager">
      <div className="section-header">
        <h2>Story Outline</h2>
        <div className="header-buttons">
          <button 
            onClick={() => setShowAIModal(true)} 
            className="ai-edit-button"
          >
            🤖 AI Edit
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
          acts.map((act, actIndex) => (
            <div key={act.id} className="act-card">
              <div className="act-header">
                <div className="act-title">
                  <span className="act-number">Act {actIndex + 1}</span>
                  <h3>{act.name}</h3>
                </div>
                <div className="act-actions">
                  <button
                    onClick={() => setShowActVersionHistory(act.id)}
                    className="version-history-button"
                  >
                    📚 History
                  </button>
                  <button
                    onClick={() => setShowActAIModal(act.id)}
                    className="ai-edit-button"
                  >
                    🤖 AI Edit
                  </button>
                  <button
                    onClick={() => setEditingAct(act)}
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

              {editingAct?.id === act.id ? (
                <EditActForm
                  act={editingAct}
                  onUpdate={(name, description) => handleUpdateAct(act.id, name, description)}
                  onCancel={() => setEditingAct(null)}
                />
              ) : (
                <div className="act-content">
                  <p className="act-description">
                    {act.description || 'No description.'}
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
                {act.chapters.map((chapter, chapterIndex) => (
                  <div key={chapter.id} className="chapter-card">
                    <div className="chapter-header">
                      <div className="chapter-title">
                        <span className="chapter-number">
                          Chapter {chapterIndex + 1}
                        </span>
                        <h4>{chapter.name}</h4>
                      </div>
                      <div className="chapter-actions">
                        <button
                          onClick={() => setShowChapterVersionHistory(chapter.id)}
                          className="version-history-button"
                        >
                          📚 History
                        </button>
                        <button
                          onClick={() => setShowChapterAIModal(chapter.id)}
                          className="ai-edit-button"
                        >
                          🤖 AI Edit
                        </button>
                        <button
                          onClick={() => setEditingChapter(chapter)}
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

                    {editingChapter?.id === chapter.id && editingChapter ? (
                      <EditChapterForm
                        chapter={editingChapter}
                        onUpdate={(name, description) => handleUpdateChapter(chapter.id, name, description)}
                        onCancel={() => setEditingChapter(null)}
                      />
                    ) : (
                      <div className="chapter-content">
                        <p className="chapter-description">
                          {chapter.description || 'No description.'}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <AIEditModal
        isOpen={showAIModal}
        onClose={() => setShowAIModal(false)}
        category="outline"
        projectId={projectId || ''}
        targetId={outline?.id || ''}
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
          projectId={projectId || ''}
          actId={showActVersionHistory}
          onRestoreVersion={handleRestoreActVersion}
        />
      )}

      {/* Chapter Version History Modal */}
      {showChapterVersionHistory && (
        <ChapterVersionHistoryModal
          isOpen={!!showChapterVersionHistory}
          onClose={() => setShowChapterVersionHistory(null)}
          projectId={projectId || ''}
          chapterId={showChapterVersionHistory}
          onRestoreVersion={handleRestoreChapterVersion}
        />
      )}
    </div>
  );
};

// Add Act Form
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

// Edit Act Form
interface EditActFormProps {
  act: Act;
  onUpdate: (name: string, description: string) => void;
  onCancel: () => void;
}

const EditActForm: React.FC<EditActFormProps> = ({ act, onUpdate, onCancel }) => {
  const [name, setName] = useState(act.name);
  const [description, setDescription] = useState(act.description);

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

// Add Chapter Form
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

// Edit Chapter Form
interface EditChapterFormProps {
  chapter: Chapter;
  onUpdate: (name: string, description: string) => void;
  onCancel: () => void;
}

const EditChapterForm: React.FC<EditChapterFormProps> = ({ chapter, onUpdate, onCancel }) => {
  const [name, setName] = useState(chapter.name);
  const [description, setDescription] = useState(chapter.description);

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

// Act Version History Modal
interface ActVersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  actId: string;
  onRestoreVersion: (versionData: any) => void;
}

const ActVersionHistoryModal: React.FC<ActVersionHistoryModalProps> = ({
  isOpen,
  onClose,
  projectId,
  actId,
  onRestoreVersion,
}) => {
  const { getActById, getActVersions } = useStoryObjectStore();
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && actId) {
      const actVersions = getActVersions(projectId, actId);
      setVersions(actVersions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      
      const activeVersion = actVersions.find(v => v.isActive);
      if (activeVersion) {
        setSelectedVersionId(activeVersion.versionId);
      }
    }
  }, [isOpen, projectId, actId, getActVersions]);

  const act = getActById(projectId, actId);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content version-history-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📚 Act "{act?.name || 'Unknown Act'}" Version History</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="version-history-content">
          {versions.length === 0 ? (
            <div className="empty-state">
              <p>No saved versions.</p>
            </div>
          ) : (
            <div className="versions-list">
              {versions.map((version, index) => (
                <div 
                  key={version.versionId} 
                  className={`version-item ${version.isActive ? 'active' : ''}`}
                >
                  <div className="version-header">
                    <div className="version-info">
                      <div className="version-title">
                        <span className="version-number">Version #{versions.length - index}</span>
                        {version.isActive && <span className="active-badge">Currently Active</span>}
                      </div>
                      <div className="version-metadata">
                        <span className="version-timestamp">
                          {new Date(version.timestamp).toLocaleString()}
                        </span>
                        <span className="version-request">
                          Request: {version.userRequest}
                        </span>
                      </div>
                    </div>

                    <div className="version-actions">
                      <button
                        onClick={() => {
                          const newExpanded = new Set(expandedVersions);
                          if (newExpanded.has(version.versionId)) {
                            newExpanded.delete(version.versionId);
                          } else {
                            newExpanded.add(version.versionId);
                          }
                          setExpandedVersions(newExpanded);
                        }}
                        className="expand-button"
                      >
                        {expandedVersions.has(version.versionId) ? '▼' : '▶'}
                      </button>
                      
                      {!version.isActive && (
                        <button
                          onClick={() => onRestoreVersion(version.data)}
                          className="restore-button"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedVersions.has(version.versionId) && (
                    <div className="version-content">
                      <h4>Version Data:</h4>
                      <div className="version-data">
                        <div className="version-data-formatted">
                          <div className="data-field">
                            <label>Name:</label>
                            <span>{version.data?.name || 'Not set'}</span>
                          </div>
                          <div className="data-field">
                            <label>Description:</label>
                            <span className="description-text">{version.data?.description || 'Not set'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
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

// Chapter Version History Modal
interface ChapterVersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  chapterId: string;
  onRestoreVersion: (versionData: any) => void;
}

const ChapterVersionHistoryModal: React.FC<ChapterVersionHistoryModalProps> = ({
  isOpen,
  onClose,
  projectId,
  chapterId,
  onRestoreVersion,
}) => {
  const { getChapterById, getChapterVersions } = useStoryObjectStore();
  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && chapterId) {
      const chapterVersions = getChapterVersions(projectId, chapterId);
      setVersions(chapterVersions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      
      const activeVersion = chapterVersions.find(v => v.isActive);
      if (activeVersion) {
        setSelectedVersionId(activeVersion.versionId);
      }
    }
  }, [isOpen, projectId, chapterId, getChapterVersions]);

  const chapter = getChapterById(projectId, chapterId);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content version-history-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📚 Chapter "{chapter?.name || 'Unknown Chapter'}" Version History</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="version-history-content">
          {versions.length === 0 ? (
            <div className="empty-state">
              <p>No saved versions.</p>
            </div>
          ) : (
            <div className="versions-list">
              {versions.map((version, index) => (
                <div 
                  key={version.versionId} 
                  className={`version-item ${version.isActive ? 'active' : ''}`}
                >
                  <div className="version-header">
                    <div className="version-info">
                      <div className="version-title">
                        <span className="version-number">Version #{versions.length - index}</span>
                        {version.isActive && <span className="active-badge">Currently Active</span>}
                      </div>
                      <div className="version-metadata">
                        <span className="version-timestamp">
                          {new Date(version.timestamp).toLocaleString()}
                        </span>
                        <span className="version-request">
                          Request: {version.userRequest}
                        </span>
                      </div>
                    </div>

                    <div className="version-actions">
                      <button
                        onClick={() => {
                          const newExpanded = new Set(expandedVersions);
                          if (newExpanded.has(version.versionId)) {
                            newExpanded.delete(version.versionId);
                          } else {
                            newExpanded.add(version.versionId);
                          }
                          setExpandedVersions(newExpanded);
                        }}
                        className="expand-button"
                      >
                        {expandedVersions.has(version.versionId) ? '▼' : '▶'}
                      </button>
                      
                      {!version.isActive && (
                        <button
                          onClick={() => onRestoreVersion(version.data)}
                          className="restore-button"
                        >
                          Restore
                        </button>
                      )}
                    </div>
                  </div>

                  {expandedVersions.has(version.versionId) && (
                    <div className="version-content">
                      <h4>Version Data:</h4>
                      <div className="version-data">
                        <div className="version-data-formatted">
                          <div className="data-field">
                            <label>Name:</label>
                            <span>{version.data?.name || 'Not set'}</span>
                          </div>
                          <div className="data-field">
                            <label>Description:</label>
                            <span className="description-text">{version.data?.description || 'Not set'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
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
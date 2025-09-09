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
    addAct,
    updateAct,
    deleteAct,
    addChapter,
    updateChapter,
    deleteChapter,
  } = useStoryObjectStore();

  const [outline, setOutlineState] = useState<Outline | null>(null);
  const [editingAct, setEditingAct] = useState<Act | null>(null);
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null);
  const [showAddActForm, setShowAddActForm] = useState(false);
  const [showAddChapterForm, setShowAddChapterForm] = useState<string | null>(null);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  useEffect(() => {
    if (projectId) {
      const storedOutline = getOutline(projectId);
      setOutlineState(storedOutline);
    }
  }, [projectId, getOutline]);

  const refreshOutline = () => {
    if (projectId) {
      const updatedOutline = getOutline(projectId);
      setOutlineState(updatedOutline);
    }
  };

  const handleAddAct = (name: string, description: string) => {
    if (projectId && name.trim()) {
      if (!outline) {
        const newOutline = createEmptyOutline();
        setOutline(projectId, newOutline);
      }
      addAct(projectId, { name: name.trim(), description: description.trim() });
      refreshOutline();
      setShowAddActForm(false);
    }
  };

  const handleUpdateAct = (actId: string, name: string, description: string) => {
    if (projectId && name.trim()) {
      updateAct(projectId, actId, { name: name.trim(), description: description.trim() });
      refreshOutline();
      setEditingAct(null);
    }
  };

  const handleDeleteAct = (actId: string) => {
    if (confirm('Are you sure you want to delete this act? All chapters within it will also be deleted.')) {
      if (projectId) {
        deleteAct(projectId, actId);
        refreshOutline();
      }
    }
  };

  const handleAddChapter = (actId: string, name: string, description: string) => {
    if (projectId && name.trim()) {
      addChapter(projectId, actId, { name: name.trim(), description: description.trim() });
      refreshOutline();
      setShowAddChapterForm(null);
    }
  };

  const handleUpdateChapter = (chapterId: string, name: string, description: string) => {
    if (projectId && name.trim()) {
      updateChapter(projectId, chapterId, { name: name.trim(), description: description.trim() });
      refreshOutline();
      setEditingChapter(null);
    }
  };

  const handleDeleteChapter = (chapterId: string) => {
    if (confirm('Are you sure you want to delete this chapter?')) {
      if (projectId) {
        deleteChapter(projectId, chapterId);
        refreshOutline();
      }
    }
  };

  const handleAIResult = (result: any) => {
    console.log('[Outline] AI result received:', result);
    console.log('[Outline] projectId:', projectId);
    
    if (!projectId) return;
    
    if (result && result.acts && Array.isArray(result.acts)) {
      console.log('[Outline] Outline edit mode');
      const newOutline = createEmptyOutline();
      
      newOutline.acts = result.acts.map((actData: any) => {
        const actId = actData.id || crypto.randomUUID();
        const existingAct = outline?.acts.find(a => a.id === actId);
        
        return {
          ...actData,
          id: actId,
          createdAt: existingAct?.createdAt || new Date(),
          updatedAt: new Date(),
          chapters: (actData.chapters || []).map((chapterData: any) => {
            const chapterId = chapterData.id || crypto.randomUUID();
            const existingChapter = existingAct?.chapters.find(c => c.id === chapterId);
            
            return {
              ...chapterData,
              id: chapterId,
              createdAt: existingChapter?.createdAt || new Date(),
              updatedAt: new Date(),
              actId: actId,
            };
          }),
        };
      });
      
      console.log('[Outline] Processed outline:', newOutline);
      setOutline(projectId, newOutline);
      refreshOutline();
    } else {
      console.log('[Outline] Result format error:', result);
    }
  };

  const handleRestoreVersion = (versionData: any) => {
    if (!projectId) return;
    
    if (versionData && versionData.acts && Array.isArray(versionData.acts)) {
      const restoredOutline = createEmptyOutline();
      
      restoredOutline.acts = versionData.acts.map((actData: any) => {
        const actId = actData.id || crypto.randomUUID();
        const existingAct = outline?.acts.find(a => a.id === actId);
        
        return {
          ...actData,
          id: actId,
          createdAt: existingAct?.createdAt || new Date(),
          updatedAt: new Date(),
          chapters: (actData.chapters || []).map((chapterData: any) => {
            const chapterId = chapterData.id || crypto.randomUUID();
            const existingChapter = existingAct?.chapters.find(c => c.id === chapterId);
            
            return {
              ...chapterData,
              id: chapterId,
              createdAt: existingChapter?.createdAt || new Date(),
              updatedAt: new Date(),
              actId: actId,
            };
          }),
        };
      });
      
      setOutline(projectId, restoredOutline);
      refreshOutline();
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
            onClick={() => setShowVersionHistory(true)} 
            className="version-history-button"
          >
            📚 Version History
          </button>
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

                    {editingChapter?.id === chapter.id ? (
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

      <VersionHistoryModal
        isOpen={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        projectId={projectId || ''}
        category="outline"
        targetId={outline?.id || ''}
        onRestoreVersion={handleRestoreVersion}
      />
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

export default OutlineManager;
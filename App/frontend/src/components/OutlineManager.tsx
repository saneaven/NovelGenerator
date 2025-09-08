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
    if (confirm('이 막을 삭제하시겠습니까? 포함된 모든 장도 삭제됩니다.')) {
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
    if (confirm('이 장을 삭제하시겠습니까?')) {
      if (projectId) {
        deleteChapter(projectId, chapterId);
        refreshOutline();
      }
    }
  };

  const handleAIResult = (result: any) => {
    console.log('[Outline] AI 결과 받음:', result);
    console.log('[Outline] projectId:', projectId);
    
    if (!projectId) return;
    
    if (result && result.acts && Array.isArray(result.acts)) {
      console.log('[Outline] 아웃라인 편집 모드');
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
      
      console.log('[Outline] 처리된 아웃라인:', newOutline);
      setOutline(projectId, newOutline);
      refreshOutline();
    } else {
      console.log('[Outline] 결과 형식 오류:', result);
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
        <p>프로젝트 ID를 찾을 수 없습니다.</p>
      </div>
    );
  }

  const acts = outline?.acts || [];

  return (
    <div className="outline-manager">
      <div className="section-header">
        <h2>스토리 아웃라인</h2>
        <div className="header-buttons">
          <button 
            onClick={() => setShowVersionHistory(true)} 
            className="version-history-button"
          >
            📚 버전 히스토리
          </button>
          <button 
            onClick={() => setShowAIModal(true)} 
            className="ai-edit-button"
          >
            🤖 AI 편집
          </button>
          <button 
            onClick={() => setShowAddActForm(true)} 
            className="add-button"
            disabled={showAddActForm}
          >
            막 추가
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
            <p>아직 생성된 막이 없습니다.</p>
            <p>새로운 막을 추가해서 스토리 구조를 만들어보세요!</p>
          </div>
        ) : (
          acts.map((act, actIndex) => (
            <div key={act.id} className="act-card">
              <div className="act-header">
                <div className="act-title">
                  <span className="act-number">제 {actIndex + 1}막</span>
                  <h3>{act.name}</h3>
                </div>
                <div className="act-actions">
                  <button
                    onClick={() => setEditingAct(act)}
                    className="edit-button"
                  >
                    편집
                  </button>
                  <button
                    onClick={() => setShowAddChapterForm(act.id)}
                    className="add-chapter-button"
                    disabled={showAddChapterForm === act.id}
                  >
                    장 추가
                  </button>
                  <button
                    onClick={() => handleDeleteAct(act.id)}
                    className="delete-button"
                  >
                    삭제
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
                    {act.description || '설명이 없습니다.'}
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
                          {chapterIndex + 1}장
                        </span>
                        <h4>{chapter.name}</h4>
                      </div>
                      <div className="chapter-actions">
                        <button
                          onClick={() => setEditingChapter(chapter)}
                          className="edit-button"
                        >
                          편집
                        </button>
                        <button
                          onClick={() => handleDeleteChapter(chapter.id)}
                          className="delete-button"
                        >
                          삭제
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
                          {chapter.description || '설명이 없습니다.'}
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
        targetId={outline?.id}
        onResult={handleAIResult}
      />

      <VersionHistoryModal
        isOpen={showVersionHistory}
        onClose={() => setShowVersionHistory(false)}
        projectId={projectId || ''}
        category="outline"
        targetId={outline?.id}
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
      <h3>새 막 추가</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="add-act-name">막 제목</label>
          <input
            id="add-act-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="막의 제목을 입력하세요"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="add-act-description">막 설명</label>
          <textarea
            id="add-act-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="이 막에서 일어나는 주요 사건들을 설명하세요"
            rows={4}
          />
        </div>
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="cancel-button">
            취소
          </button>
          <button type="submit" className="save-button">
            추가
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
          <label htmlFor="edit-act-name">막 제목</label>
          <input
            id="edit-act-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="막의 제목을 입력하세요"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="edit-act-description">막 설명</label>
          <textarea
            id="edit-act-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="이 막에서 일어나는 주요 사건들을 설명하세요"
            rows={4}
          />
        </div>
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="cancel-button">
            취소
          </button>
          <button type="submit" className="save-button">
            저장
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
      <h4>새 장 추가</h4>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="add-chapter-name">장 제목</label>
          <input
            id="add-chapter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="장의 제목을 입력하세요"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="add-chapter-description">장 설명</label>
          <textarea
            id="add-chapter-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="이 장에서 일어나는 일들을 설명하세요"
            rows={3}
          />
        </div>
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="cancel-button">
            취소
          </button>
          <button type="submit" className="save-button">
            추가
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
          <label htmlFor="edit-chapter-name">장 제목</label>
          <input
            id="edit-chapter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="장의 제목을 입력하세요"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="edit-chapter-description">장 설명</label>
          <textarea
            id="edit-chapter-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="이 장에서 일어나는 일들을 설명하세요"
            rows={3}
          />
        </div>
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="cancel-button">
            취소
          </button>
          <button type="submit" className="save-button">
            저장
          </button>
        </div>
      </form>
    </div>
  );
};

export default OutlineManager;
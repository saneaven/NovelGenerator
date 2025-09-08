import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useStoryObjectStore } from '../store/storyObjectStore';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import type { NameDescriptionItem, StoryObjectCategory } from '../types/storyObject';

interface NameDescriptionManagerProps {
  category: Extract<StoryObjectCategory, 'character' | 'organization' | 'location' | 'lorebook'>;
  title: string;
  singularName: string;
  pluralName: string;
  placeholder?: {
    name: string;
    description: string;
  };
}

const NameDescriptionManager: React.FC<NameDescriptionManagerProps> = ({
  category,
  title,
  singularName,
  pluralName,
  placeholder = { name: '이름을 입력하세요', description: '설명을 입력하세요' },
}) => {
  const { projectId } = useParams<{ projectId: string }>();
  const storeActions = useStoryObjectStore();
  const [items, setItems] = useState<NameDescriptionItem[]>([]);
  const [editingItem, setEditingItem] = useState<NameDescriptionItem | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiEditTargetId, setAiEditTargetId] = useState<string | undefined>(undefined);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | undefined>(undefined);

  // Get appropriate store methods based on category
  const getItems = () => {
    if (!projectId) return [];
    switch (category) {
      case 'character':
        return storeActions.getCharacters(projectId);
      case 'organization':
        return storeActions.getOrganizations(projectId);
      case 'location':
        return storeActions.getLocations(projectId);
      case 'lorebook':
        return storeActions.getLorebookEntries(projectId);
      default:
        return [];
    }
  };

  const addItem = (item: Partial<NameDescriptionItem>) => {
    if (!projectId) return;
    switch (category) {
      case 'character':
        return storeActions.addCharacter(projectId, item);
      case 'organization':
        return storeActions.addOrganization(projectId, item);
      case 'location':
        return storeActions.addLocation(projectId, item);
      case 'lorebook':
        return storeActions.addLorebookEntry(projectId, item);
    }
  };

  const updateItem = (id: string, updates: Partial<Omit<NameDescriptionItem, 'id' | 'createdAt'>>) => {
    if (!projectId) return;
    switch (category) {
      case 'character':
        storeActions.updateCharacter(projectId, id, updates);
        break;
      case 'organization':
        storeActions.updateOrganization(projectId, id, updates);
        break;
      case 'location':
        storeActions.updateLocation(projectId, id, updates);
        break;
      case 'lorebook':
        storeActions.updateLorebookEntry(projectId, id, updates);
        break;
    }
  };

  const deleteItem = (id: string) => {
    if (!projectId) return;
    switch (category) {
      case 'character':
        storeActions.deleteCharacter(projectId, id);
        break;
      case 'organization':
        storeActions.deleteOrganization(projectId, id);
        break;
      case 'location':
        storeActions.deleteLocation(projectId, id);
        break;
      case 'lorebook':
        storeActions.deleteLorebookEntry(projectId, id);
        break;
    }
  };

  useEffect(() => {
    setItems(getItems());
  }, [projectId, category]);

  const handleAdd = (name: string, description: string) => {
    if (name.trim()) {
      addItem({ name: name.trim(), description: description.trim() });
      setItems(getItems());
      setShowAddForm(false);
    }
  };

  const handleEdit = (item: NameDescriptionItem) => {
    setEditingItem({ ...item });
  };

  const handleUpdate = (name: string, description: string) => {
    if (editingItem && name.trim()) {
      updateItem(editingItem.id, {
        name: name.trim(),
        description: description.trim(),
      });
      setItems(getItems());
      setEditingItem(null);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm(`이 ${singularName}을(를) 삭제하시겠습니까?`)) {
      deleteItem(id);
      setItems(getItems());
    }
  };

  const handleCancelEdit = () => {
    setEditingItem(null);
  };

  const handleAIEdit = (itemId?: string) => {
    setAiEditTargetId(itemId);
    setShowAIModal(true);
  };

  const handleAIResult = (result: any) => {
    console.log(`[${category}] AI 결과 받음:`, result);
    console.log(`[${category}] aiEditTargetId:`, aiEditTargetId);
    console.log(`[${category}] projectId:`, projectId);
    
    if (!projectId) return;
    
    if (aiEditTargetId) {
      // Editing specific item - should always be an update
      console.log(`[${category}] 개별 아이템 편집 모드`);
      if (result && result.name !== undefined && result.description !== undefined) {
        console.log(`[${category}] 아이템 업데이트 중:`, result.id || aiEditTargetId, result);
        updateItem(result.id || aiEditTargetId, {
          name: result.name,
          description: result.description,
        });
      } else {
        console.log(`[${category}] 결과 데이터 형식이 잘못됨:`, result);
      }
    } else {
      // Editing entire category - handle based on ID (null = add, existing ID = update)
      console.log(`[${category}] 전체 카테고리 편집 모드`);
      if (Array.isArray(result)) {
        console.log(`[${category}] 배열 길이:`, result.length);
        
        result.forEach((item: any, index: number) => {
          console.log(`[${category}] 아이템 ${index}:`, item);
          if (item.name !== undefined && item.description !== undefined) {
            if (item.id === null || item.id === undefined) {
              // 새 아이템 추가
              console.log(`[${category}] 새 아이템 ${index} 추가:`, item);
              addItem({
                name: item.name,
                description: item.description,
              });
            } else {
              // 기존 아이템 수정
              console.log(`[${category}] 기존 아이템 ${index} 업데이트:`, item.id);
              updateItem(item.id, {
                name: item.name,
                description: item.description,
              });
            }
          } else {
            console.log(`[${category}] 아이템 ${index} 형식 오류:`, item);
          }
        });
      } else {
        console.log(`[${category}] 결과가 배열이 아님:`, result);
      }
    }
    
    setItems(getItems());
    console.log(`[${category}] 아이템 목록 새로고침 완료`);
  };

  const handleShowVersionHistory = (itemId: string) => {
    setVersionHistoryTargetId(itemId);
    setShowVersionHistory(true);
  };

  const handleRestoreVersion = (versionData: any) => {
    if (!projectId || !versionHistoryTargetId) return;
    
    // Individual item restoration only
    if (versionData && versionData.name !== undefined && versionData.description !== undefined) {
      updateItem(versionHistoryTargetId, {
        name: versionData.name,
        description: versionData.description,
      });
      setItems(getItems());
    }
  };

  if (!projectId) {
    return (
      <div className="error-container">
        <p>프로젝트 ID를 찾을 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div className="name-description-manager">
      <div className="section-header">
        <h2>{title}</h2>
        <div className="header-buttons">
          <button 
            onClick={() => handleAIEdit()} 
            className="ai-edit-button"
            disabled={showAddForm}
          >
            🤖 전체 AI 편집
          </button>
          <button 
            onClick={() => setShowAddForm(true)} 
            className="add-button"
            disabled={showAddForm}
          >
            {singularName} 추가
          </button>
        </div>
      </div>

      {showAddForm && (
        <AddItemForm
          placeholder={placeholder}
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
          singularName={singularName}
        />
      )}

      <div className="items-list">
        {items.length === 0 ? (
          <div className="empty-state">
            <p>{pluralName}이(가) 없습니다.</p>
            <p>새로운 {singularName}을(를) 추가해보세요!</p>
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="item-card">
              {editingItem?.id === item.id ? (
                <EditItemForm
                  item={editingItem}
                  placeholder={placeholder}
                  onUpdate={handleUpdate}
                  onCancel={handleCancelEdit}
                />
              ) : (
                <ItemDisplay
                  item={item}
                  onEdit={() => handleEdit(item)}
                  onDelete={() => handleDelete(item.id)}
                  onAIEdit={() => handleAIEdit(item.id)}
                  onVersionHistory={() => handleShowVersionHistory(item.id)}
                />
              )}
            </div>
          ))
        )}
      </div>

      <AIEditModal
        isOpen={showAIModal}
        onClose={() => {
          setShowAIModal(false);
          setAiEditTargetId(undefined);
        }}
        category={category}
        projectId={projectId || ''}
        targetId={aiEditTargetId}
        onResult={handleAIResult}
      />

      {versionHistoryTargetId && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => {
            setShowVersionHistory(false);
            setVersionHistoryTargetId(undefined);
          }}
          projectId={projectId || ''}
          category={category}
          targetId={versionHistoryTargetId}
          onRestoreVersion={handleRestoreVersion}
        />
      )}
    </div>
  );
};

// Add Item Form Component
interface AddItemFormProps {
  placeholder: { name: string; description: string };
  onAdd: (name: string, description: string) => void;
  onCancel: () => void;
  singularName: string;
}

const AddItemForm: React.FC<AddItemFormProps> = ({
  placeholder,
  onAdd,
  onCancel,
  singularName,
}) => {
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
      <h3>새 {singularName} 추가</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="add-name">이름</label>
          <input
            id="add-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder.name}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="add-description">설명</label>
          <textarea
            id="add-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={placeholder.description}
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

// Edit Item Form Component
interface EditItemFormProps {
  item: NameDescriptionItem;
  placeholder: { name: string; description: string };
  onUpdate: (name: string, description: string) => void;
  onCancel: () => void;
}

const EditItemForm: React.FC<EditItemFormProps> = ({
  item,
  placeholder,
  onUpdate,
  onCancel,
}) => {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(name, description);
  };

  return (
    <div className="item-form edit-form">
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="edit-name">이름</label>
          <input
            id="edit-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={placeholder.name}
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="edit-description">설명</label>
          <textarea
            id="edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={placeholder.description}
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

// Item Display Component
interface ItemDisplayProps {
  item: NameDescriptionItem;
  onEdit: () => void;
  onDelete: () => void;
  onAIEdit: () => void;
  onVersionHistory: () => void;
}

const ItemDisplay: React.FC<ItemDisplayProps> = ({ item, onEdit, onDelete, onAIEdit, onVersionHistory }) => {
  return (
    <div className="item-display">
      <div className="item-header">
        <h4>{item.name}</h4>
        <div className="item-actions">
          <button onClick={onVersionHistory} className="version-history-button">
            📚
          </button>
          <button onClick={onAIEdit} className="ai-edit-button">
            🤖 AI 편집
          </button>
          <button onClick={onEdit} className="edit-button">
            편집
          </button>
          <button onClick={onDelete} className="delete-button">
            삭제
          </button>
        </div>
      </div>
      <div className="item-content">
        <p className="item-description">
          {item.description || '설명이 없습니다.'}
        </p>
      </div>
      <div className="item-metadata">
        <p className="last-updated">
          마지막 수정: {item.updatedAt.toLocaleString()}
        </p>
      </div>
    </div>
  );
};

export default NameDescriptionManager;
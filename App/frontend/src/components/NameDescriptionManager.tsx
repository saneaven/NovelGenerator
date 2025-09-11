import React, { useState } from 'react';
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
  placeholder = { name: 'Enter name', description: 'Enter description' },
}) => {
  const { projectId } = useParams<{ projectId: string }>();
  const storeActions = useStoryObjectStore();
  const [editingItem, setEditingItem] = useState<NameDescriptionItem | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiEditTargetId, setAiEditTargetId] = useState<string | undefined>(undefined);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | undefined>(undefined);

  // Get items directly from store - this will automatically re-render when store updates
  const items = (() => {
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
  })();

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


  const handleAdd = (name: string, description: string) => {
    if (name.trim()) {
      addItem({ name: name.trim(), description: description.trim() });
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
      setEditingItem(null);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm(`Are you sure you want to delete this ${singularName}?`)) {
      deleteItem(id);
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
    if (!projectId) return;

    if (aiEditTargetId) {
      // Editing specific item - should always be an update
      if (result && result.name !== undefined && result.description !== undefined) {
        // Use AI-specific update function that automatically creates version
        switch (category) {
          case 'character':
            storeActions.updateCharacterAI(projectId, result.id || aiEditTargetId, {
              name: result.name,
              description: result.description,
            });
            break;
          case 'organization':
            updateItem(result.id || aiEditTargetId, {
              name: result.name,
              description: result.description,
            });
            // Manual version creation for now - TODO: add AI update function
            storeActions.addVersion(projectId, category, result.id || aiEditTargetId, 'AI Edit', {
              name: result.name,
              description: result.description,
            });
            break;
          case 'location':
            updateItem(result.id || aiEditTargetId, {
              name: result.name,
              description: result.description,
            });
            // Manual version creation for now - TODO: add AI update function
            storeActions.addVersion(projectId, category, result.id || aiEditTargetId, 'AI Edit', {
              name: result.name,
              description: result.description,
            });
            break;
          case 'lorebook':
            updateItem(result.id || aiEditTargetId, {
              name: result.name,
              description: result.description,
            });
            // Manual version creation for now - TODO: add AI update function
            storeActions.addVersion(projectId, category, result.id || aiEditTargetId, 'AI Edit', {
              name: result.name,
              description: result.description,
            });
            break;
        }
      }
    } else {
      // Editing entire category - handle based on ID (null = add, existing ID = update)
      if (Array.isArray(result)) {
        result.forEach((item: any) => {
          if (item.name !== undefined && item.description !== undefined) {
            if (item.id === null || item.id === undefined) {
              // Add new item
              addItem({
                name: item.name,
                description: item.description,
              });
            } else {
              // Update existing item using regular update function (versions auto-created)
              updateItem(item.id, {
                name: item.name,
                description: item.description,
              });
            }
          }
        });
      }
    }
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
    }
  };

  if (!projectId) {
    return (
      <div className="error-container">
        <p>Project ID not found.</p>
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
            🤖 AI Edit All
          </button>
          <button 
            onClick={() => setShowAddForm(true)} 
            className="add-button"
            disabled={showAddForm}
          >
            Add {singularName}
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
            <p>No {pluralName} found.</p>
            <p>Try adding a new {singularName}!</p>
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
      <h3>Add New {singularName}</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="add-name">Name</label>
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
          <label htmlFor="add-description">Description</label>
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
          <label htmlFor="edit-name">Name</label>
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
          <label htmlFor="edit-description">Description</label>
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
            🤖 AI Edit
          </button>
          <button onClick={onEdit} className="edit-button">
            Edit
          </button>
          <button onClick={onDelete} className="delete-button">
            Delete
          </button>
        </div>
      </div>
      <div className="item-content">
        <p className="item-description">
          {item.description || 'No description.'}
        </p>
      </div>
      <div className="item-metadata">
        <p className="last-updated">
          Last updated: {item.updatedAt.toLocaleString()}
        </p>
      </div>
    </div>
  );
};

export default NameDescriptionManager;
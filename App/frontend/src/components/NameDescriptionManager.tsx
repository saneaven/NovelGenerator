import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useStoryObjectStore } from '../store/storyObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import { translateStoryObject, getDisplayDataForItem } from '../utils/storyObjectTranslation';
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
  const { settings } = useSettingsStore();
  const [editingItem, setEditingItem] = useState<NameDescriptionItem | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiEditTargetId, setAiEditTargetId] = useState<string | undefined>(undefined);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | undefined>(undefined);

  // Language state management
  const [itemLanguages, setItemLanguages] = useState<Record<string, string>>({});
  const [translatingItems, setTranslatingItems] = useState<Record<string, boolean>>({});

  const primaryLanguage = settings.primaryLanguage;
  const secondaryLanguage = settings.secondaryLanguage;

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

  const updateItem = (id: string, updates: Partial<Omit<NameDescriptionItem, 'id' | 'createdAt'>>, editLanguage?: string) => {
    if (!projectId) return;
    switch (category) {
      case 'character':
        storeActions.updateCharacter(projectId, id, updates, editLanguage);
        break;
      case 'organization':
        storeActions.updateOrganization(projectId, id, updates, editLanguage);
        break;
      case 'location':
        storeActions.updateLocation(projectId, id, updates, editLanguage);
        break;
      case 'lorebook':
        storeActions.updateLorebookEntry(projectId, id, updates, editLanguage);
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

  // Initialize language preferences for each item
  useEffect(() => {
    if (!projectId) return;

    const newLanguages: Record<string, string> = {};
    items.forEach((item) => {
      if (!itemLanguages[item.id]) {
        const displayInfo = getDisplayDataForItem(
          projectId,
          category,
          item.id,
          primaryLanguage,
          primaryLanguage,
          secondaryLanguage
        );
        newLanguages[item.id] = displayInfo.displayLanguage;
      }
    });

    if (Object.keys(newLanguages).length > 0) {
      setItemLanguages((prev) => ({ ...prev, ...newLanguages }));
    }
  }, [items, projectId, category, primaryLanguage, secondaryLanguage]);

  // Sync flat fields with active language on mount
  useEffect(() => {
    if (!projectId) return;

    items.forEach((item) => {
      const currentLang = itemLanguages[item.id] || primaryLanguage;
      storeActions.syncFlatFieldsWithLanguage(projectId, category, item.id, currentLang);
    });
  }, [itemLanguages, projectId, category]);

  const handleLanguageToggle = async (itemId: string) => {
    if (!projectId || !secondaryLanguage) return;

    const currentLang = itemLanguages[itemId] || primaryLanguage;
    const targetLang = currentLang === secondaryLanguage ? primaryLanguage : secondaryLanguage;

    // Check if target language data exists
    const hasTargetLang = storeActions.hasItemDataInLanguage(projectId, category, itemId, targetLang);

    if (hasTargetLang) {
      setItemLanguages((prev) => ({ ...prev, [itemId]: targetLang }));
      storeActions.syncFlatFieldsWithLanguage(projectId, category, itemId, targetLang);
      return;
    }

    // Need to translate
    const availableLanguages = storeActions.getAvailableLanguagesForItem(projectId, category, itemId);
    if (availableLanguages.length === 0) return;

    const sourceLang = availableLanguages.includes(currentLang) ? currentLang : availableLanguages[0];

    try {
      await translateStoryObject({
        projectId,
        category,
        itemId,
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        aiModel: settings.aiModel,
        onTranslating: (isTranslating) => {
          setTranslatingItems((prev) => ({ ...prev, [itemId]: isTranslating }));
        },
      });

      setItemLanguages((prev) => ({ ...prev, [itemId]: targetLang }));
      storeActions.syncFlatFieldsWithLanguage(projectId, category, itemId, targetLang);
    } catch (error) {
      console.error('Translation failed:', error);
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

  const handleUpdate = async (name: string, description: string) => {
    if (!editingItem || !name.trim() || !projectId) return;

    const currentLang = itemLanguages[editingItem.id] || primaryLanguage;
    const itemId = editingItem.id; // Capture itemId before setting editingItem to null

    updateItem(itemId, {
      name: name.trim(),
      description: description.trim(),
    }, currentLang);

    setEditingItem(null);

    // Check if primary language data exists in the new version
    // Wait a bit for the store to update
    setTimeout(async () => {
      const hasPrimaryLanguage = storeActions.hasItemDataInLanguage(projectId, category, itemId, primaryLanguage);

      if (!hasPrimaryLanguage && currentLang !== primaryLanguage) {
        // Ask user if they want to translate to primary language
        const shouldTranslate = confirm(
          `You edited this ${singularName} in ${currentLang}. Would you like to translate it to ${primaryLanguage}?`
        );

        if (shouldTranslate) {
          try {
            await translateStoryObject({
              projectId,
              category,
              itemId,
              sourceLanguage: currentLang,
              targetLanguage: primaryLanguage,
              aiModel: settings.aiModel,
              onTranslating: (isTranslating) => {
                setTranslatingItems((prev) => ({ ...prev, [itemId]: isTranslating }));
              },
            });

            // Sync flat fields with primary language after translation
            storeActions.syncFlatFieldsWithLanguage(projectId, category, itemId, primaryLanguage);
            setItemLanguages((prev) => ({ ...prev, [itemId]: primaryLanguage }));
          } catch (error) {
            console.error('Translation failed:', error);
          }
        }
      }
    }, 100);
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
                  projectId={projectId!}
                  category={category}
                  currentLanguage={itemLanguages[item.id] || primaryLanguage}
                  isTranslating={translatingItems[item.id] || false}
                  showTranslateButton={Boolean(secondaryLanguage)}
                  onEdit={() => handleEdit(item)}
                  onDelete={() => handleDelete(item.id)}
                  onAIEdit={() => handleAIEdit(item.id)}
                  onVersionHistory={() => handleShowVersionHistory(item.id)}
                  onLanguageToggle={() => handleLanguageToggle(item.id)}
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
  projectId: string;
  category: StoryObjectCategory;
  currentLanguage: string;
  isTranslating: boolean;
  showTranslateButton: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAIEdit: () => void;
  onVersionHistory: () => void;
  onLanguageToggle: () => void;
}

const ItemDisplay: React.FC<ItemDisplayProps> = ({
  item,
  projectId,
  category,
  currentLanguage,
  isTranslating,
  showTranslateButton,
  onEdit,
  onDelete,
  onAIEdit,
  onVersionHistory,
  onLanguageToggle,
}) => {
  const { settings } = useSettingsStore();

  const displayInfo = getDisplayDataForItem(
    projectId,
    category,
    item.id,
    currentLanguage,
    settings.primaryLanguage,
    settings.secondaryLanguage
  );

  const showMissingLanguageWarning = !displayInfo.hasRequestedLanguage;

  return (
    <div className="item-display">
      <div className="item-header">
        <h4>{item.name}</h4>
        <div className="item-actions">
          {showTranslateButton && (
            <button
              onClick={onLanguageToggle}
              className="translate-button"
              disabled={isTranslating}
              title={`Translate to ${currentLanguage === settings.secondaryLanguage ? settings.primaryLanguage : settings.secondaryLanguage}`}
            >
              {isTranslating ? '⏳' : '🌐'}
            </button>
          )}
          <button onClick={onVersionHistory} className="version-history-button" title="Version History">
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
      {showMissingLanguageWarning && (
        <div className="missing-language-warning">
          <p>⚠️ No {currentLanguage} version available. Displaying {displayInfo.fallbackLanguage} version.</p>
          <button
            onClick={onLanguageToggle}
            className="generate-translation-button"
            disabled={isTranslating}
          >
            {isTranslating ? 'Generating...' : `Generate ${currentLanguage} Version`}
          </button>
        </div>
      )}
      <div className="item-content">
        <p className="item-description">
          {item.description || 'No description.'}
        </p>
      </div>
      <div className="item-metadata">
        <span className="item-language">Language: {currentLanguage}</span>
        <span className="last-updated">
          Last updated: {item.updatedAt.toLocaleString()}
        </span>
      </div>
    </div>
  );
};

export default NameDescriptionManager;
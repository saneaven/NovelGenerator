/**
 * NameDescriptionManager - Migrated to New Unified Translation System
 *
 * Manages collections of name/description objects (Character, Organization, Location, Lorebook)
 *
 * Features:
 * - List, create, update, delete objects
 * - Multi-language support with translations
 * - Version history and rollback
 * - AI-powered editing
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import { LanguageSwitcher } from './LanguageSwitcher';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import RetranslateModal from './RetranslateModal';
import { TranslationService } from '../services/translationService';
import type { UnifiedObject, ObjectType } from '../types/unifiedObject';

interface NameDescriptionData {
  name: string;
  description: string;
}

type NameDescriptionObject = UnifiedObject<NameDescriptionData>;

interface NameDescriptionManagerProps {
  category: Extract<ObjectType, 'character' | 'organization' | 'location' | 'lorebook'>;
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
  const store = useUnifiedObjectStore();
  const listObjects = useUnifiedObjectStore(state => state.listObjects);
  const { settings } = useSettingsStore();
  const { showError } = useErrorStore();

  const objects = store.objects;
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiEditTargetId, setAiEditTargetId] = useState<string | undefined>(undefined);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | undefined>(undefined);
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [retranslateTargetId, setRetranslateTargetId] = useState<string | undefined>(undefined);

  // Fetch list of items from backend
  useEffect(() => {
    if (!projectId) return;

    let isCancelled = false;

    const fetchItems = async () => {
      try {
        await listObjects(category, projectId);
      } catch (error) {
        if (!isCancelled) {
          console.error(`Failed to fetch ${category} list:`, error);
        }
      }
    };

    fetchItems();

    return () => {
      isCancelled = true;
    };
  }, [projectId, category, listObjects]);

  // Derive items directly from store so external edits instantly reflect in UI
  const items = useMemo(() => {
    if (!projectId) {
      return [];
    }

    return Object.values(objects)
      .filter(
        (obj): obj is NameDescriptionObject =>
          Boolean(
            obj &&
            obj.type === category &&
            obj.metadata?.project_id === projectId
          )
      )
      .sort((a, b) => {
        const orderA = a.metadata.order ?? 0;
        const orderB = b.metadata.order ?? 0;
        if (orderA === orderB) {
          return a.data.name.localeCompare(b.data.name);
        }
        return orderA - orderB;
      });
  }, [objects, category, projectId]);

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  const handleAdd = async (name: string, description: string) => {
    if (!projectId || !name.trim()) return;

    try {
      await store.createObject(
        category,
        projectId,
        { name: name.trim(), description: description.trim() },
        settings.primaryLanguage
      );
      setShowAddForm(false);
    } catch (error) {
      console.error('Failed to add item:', error);
      showError('Create Error', 'Failed to add item. Please try again.');
    }
  };

  const handleUpdate = async (itemId: string, name: string, description: string) => {
    if (!name.trim()) return;

    const item = store.objects[itemId] as NameDescriptionObject;
    if (!item) return;

    try {
      await store.updateObject(category, itemId, {
        data: {
          name: name.trim(),
          description: description.trim(),
        },
        language: item.languages.active,
        user_request: 'User Edit',
        create_new_version: true,
      });

      setEditingItemId(null);
    } catch (error) {
      console.error('Failed to update item:', error);
      showError('Update Error', 'Failed to update. Please try again.');
    }
  };

  const handleDelete = async (itemId: string) => {
    if (!confirm(`Are you sure you want to delete this ${singularName}?`)) {
      return;
    }

    try {
      await store.deleteObject(category, itemId);
    } catch (error) {
      console.error('Failed to delete item:', error);
      showError('Delete Error', 'Failed to delete. Please try again.');
    }
  };

  // ============================================================================
  // LANGUAGE & TRANSLATION
  // ============================================================================

  const handleLanguageChange = async (itemId: string, newLanguage: string) => {
    const item = store.objects[itemId] as NameDescriptionObject;
    if (!item) return;

    try {
      await store.switchLanguage(category, itemId, newLanguage);
    } catch (error) {
      console.error('Failed to switch language:', error);
      showError('Language Switch Error', 'Failed to switch language. Please try again.');
    }
  };

  const handleAddTranslation = async (itemId: string) => {
    if (!projectId) return;

    const item = store.objects[itemId] as NameDescriptionObject;
    if (!item) return;

    const targetLanguage = settings.secondaryLanguage;
    if (!targetLanguage) {
      showError('Warning', 'Please set a secondary language in settings first.');
      return;
    }

    if (item.languages.available.includes(targetLanguage)) {
      // Just switch to it
      await handleLanguageChange(itemId, targetLanguage);
      return;
    }

    try {
      TranslationService.setTranslationStatus(itemId, { objectId: itemId, isTranslating: true });
      await TranslationService.translateSingle(
        {
          objectType: category,
          objectId: itemId,
          sourceData: {
            name: item.data.name,
            description: item.data.description,
          },
        },
        {
          projectId,
          sourceLanguage: item.languages.active,
          targetLanguage,
        }
      );

      // Refresh object to update UI with new translation
      await store.fetchObject(category, itemId);

      showError('Success', `Translation added for ${targetLanguage}`);
    } catch (error) {
      console.error('Failed to add translation:', error);
      showError('Translation Error', error instanceof Error ? error.message : 'Failed to add translation. Please try again.');
    } finally {
      TranslationService.clearTranslationStatus(itemId);
    }
  };

  const handleRetranslate = async (includePrevious: boolean, userInstructions: string) => {
    if (!projectId || !retranslateTargetId) return;

    const item = store.objects[retranslateTargetId] as NameDescriptionObject;
    if (!item) return;

    const targetLanguage = settings.secondaryLanguage;
    if (!targetLanguage) {
      showError('Warning', 'Please set a secondary language in settings first.');
      return;
    }

    try {
      TranslationService.setTranslationStatus(retranslateTargetId, {
        objectId: retranslateTargetId,
        isTranslating: true,
      });

      // Build custom user instructions with optional previous translation
      let instructions = userInstructions || '';

      if (includePrevious && item.languages.available.includes(targetLanguage)) {
        const prevTranslation = `Previous translation for reference:\n${JSON.stringify({
          name: item.data.name,
          description: item.data.description,
        }, null, 2)}`;
        instructions = instructions ? `${instructions}\n\n${prevTranslation}` : prevTranslation;
      }

      await TranslationService.translateSingle(
        {
          objectType: category,
          objectId: retranslateTargetId,
          sourceData: {
            name: item.data.name,
            description: item.data.description,
          },
        },
        {
          projectId,
          sourceLanguage: item.languages.active,
          targetLanguage,
          userInstructions: instructions || undefined,
        }
      );

      // Refresh object to update UI with new translation
      await store.fetchObject(category, retranslateTargetId);

      showError('Success', `Retranslation complete for ${targetLanguage}`);
      setShowRetranslateModal(false);
      setRetranslateTargetId(undefined);
    } catch (error) {
      console.error('Failed to retranslate:', error);
      showError('Retranslation Error', error instanceof Error ? error.message : 'Failed to retranslate. Please try again.');
    } finally {
      TranslationService.clearTranslationStatus(retranslateTargetId);
    }
  };

  // ============================================================================
  // AI & VERSION MANAGEMENT
  // ============================================================================

  const handleAIEdit = (itemId?: string) => {
    setAiEditTargetId(itemId);
    setShowAIModal(true);
  };

  const handleAIResult = async (result: any) => {
    if (!projectId) return;

    if (aiEditTargetId) {
      // Editing specific item
      if (result && result.name !== undefined && result.description !== undefined) {
        const item = store.objects[aiEditTargetId] as NameDescriptionObject;
        if (!item) return;

        try {
          await store.updateObject(category, aiEditTargetId, {
            data: {
              name: result.name,
              description: result.description,
            },
            language: item.languages.active,
            user_request: 'AI Edit',
            create_new_version: true,
          });
        } catch (error) {
          console.error('Failed to apply AI edit:', error);
          showError('AI Edit Error', 'Failed to apply AI edit. Please try again.');
        }
      }
    } else {
      // Batch editing - handle array of results
      if (Array.isArray(result)) {
        for (const itemResult of result) {
          if (itemResult.name !== undefined && itemResult.description !== undefined) {
            if (itemResult.id) {
              // Update existing
              const item = store.objects[itemResult.id] as NameDescriptionObject;
              if (item) {
                await store.updateObject(category, itemResult.id, {
                  data: {
                    name: itemResult.name,
                    description: itemResult.description,
                  },
                  language: item.languages.active,
                  user_request: 'AI Edit',
                  create_new_version: true,
                });
              }
            } else {
              // Create new
              await handleAdd(itemResult.name, itemResult.description);
            }
          }
        }
      }
    }
  };

  const handleShowVersionHistory = (itemId: string) => {
    setVersionHistoryTargetId(itemId);
    setShowVersionHistory(true);
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!versionHistoryTargetId) return;

    try {
      await store.activateVersion(category, versionHistoryTargetId, versionId);
      console.log('✓ Version restored');
    } catch (error) {
      console.error('Failed to restore version:', error);
      showError('Restore Error', 'Failed to restore version. Please try again.');
    }
  };

  // ============================================================================
  // RENDER
  // ============================================================================

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
          items.map((item) => {
            const isEditing = editingItemId === item.id;
            const loading = store.loading[item.id] || false;

            return (
              <div key={item.id} className="item-card">
                {isEditing ? (
                  <EditItemForm
                    item={item}
                    placeholder={placeholder}
                    onUpdate={(name, desc) => handleUpdate(item.id, name, desc)}
                    onCancel={() => setEditingItemId(null)}
                    disabled={loading}
                  />
                ) : (
                  <ItemDisplay
                    item={item}
                    category={category}
                    loading={loading}
                    showSecondaryLanguage={Boolean(settings.secondaryLanguage)}
                    secondaryLanguage={settings.secondaryLanguage}
                    onEdit={() => setEditingItemId(item.id)}
                    onDelete={() => handleDelete(item.id)}
                    onAIEdit={() => handleAIEdit(item.id)}
                    onVersionHistory={() => handleShowVersionHistory(item.id)}
                    onLanguageChange={(lang) => handleLanguageChange(item.id, lang)}
                    onAddTranslation={() => handleAddTranslation(item.id)}
                    onRetranslate={() => {
                      setRetranslateTargetId(item.id);
                      setShowRetranslateModal(true);
                    }}
                  />
                )}
              </div>
            );
          })
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
          objectType={category}
          objectId={versionHistoryTargetId!}
          onRestoreVersion={handleRestoreVersion}
        />
      )}

      {retranslateTargetId && settings.secondaryLanguage && (
        <RetranslateModal
          isOpen={showRetranslateModal}
          onClose={() => {
            setShowRetranslateModal(false);
            setRetranslateTargetId(undefined);
          }}
          sourceLanguage={store.objects[retranslateTargetId]?.languages?.active || settings.primaryLanguage}
          targetLanguage={settings.secondaryLanguage}
          translationTimestamp={store.objects[retranslateTargetId]?.version?.created_at || null}
          onRetranslate={handleRetranslate}
          isTranslating={store.loading[retranslateTargetId] || false}
        />
      )}
    </div>
  );
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

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
  item: NameDescriptionObject;
  placeholder: { name: string; description: string };
  onUpdate: (name: string, description: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

const EditItemForm: React.FC<EditItemFormProps> = ({
  item,
  placeholder,
  onUpdate,
  onCancel,
  disabled,
}) => {
  const [name, setName] = useState(item.data.name);
  const [description, setDescription] = useState(item.data.description);

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
            disabled={disabled}
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
            disabled={disabled}
          />
        </div>
        <div className="form-actions">
          <button type="button" onClick={onCancel} className="cancel-button" disabled={disabled}>
            Cancel
          </button>
          <button type="submit" className="save-button" disabled={disabled}>
            {disabled ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};

// Item Display Component
interface ItemDisplayProps {
  item: NameDescriptionObject;
  category: ObjectType;
  loading: boolean;
  showSecondaryLanguage: boolean;
  secondaryLanguage?: string;
  onEdit: () => void;
  onDelete: () => void;
  onAIEdit: () => void;
  onVersionHistory: () => void;
  onLanguageChange: (language: string) => void;
  onAddTranslation: () => void;
  onRetranslate: () => void;
}

const ItemDisplay: React.FC<ItemDisplayProps> = ({
  item,
  category,
  loading,
  showSecondaryLanguage,
  secondaryLanguage,
  onEdit,
  onDelete,
  onAIEdit,
  onVersionHistory,
  onLanguageChange,
  onAddTranslation,
  onRetranslate,
}) => {
  return (
    <div className="item-display">
      <div className="item-header">
        <h4>{item.data.name}</h4>
        <div className="item-actions">
          <LanguageSwitcher
            object={item}
            onLanguageChange={onLanguageChange}
            disabled={loading}
            showLabel={false}
          />
          {showSecondaryLanguage && secondaryLanguage && (
            item.languages.available.includes(secondaryLanguage) ? (
              <button
                onClick={onRetranslate}
                className="translate-button retranslate"
                disabled={loading}
                title={`Retranslate to ${secondaryLanguage}`}
              >
                🔄 Retranslate
              </button>
            ) : (
              <button
                onClick={onAddTranslation}
                className="translate-button"
                disabled={loading}
                title={`Add ${secondaryLanguage} translation`}
              >
                🌐 Add {secondaryLanguage}
              </button>
            )
          )}
          <button onClick={onVersionHistory} className="version-history-button" title="Version History" disabled={loading}>
            📚
          </button>
          <button onClick={onAIEdit} className="ai-edit-button" disabled={loading}>
            🤖 AI Edit
          </button>
          <button onClick={onEdit} className="edit-button" disabled={loading}>
            Edit
          </button>
          <button onClick={onDelete} className="delete-button" disabled={loading}>
            Delete
          </button>
        </div>
      </div>
      <div className="item-content">
        <p className="item-description">{item.data.description || 'No description.'}</p>
      </div>
      <div className="item-metadata">
        <span className="item-language">Language: {item.languages.active}</span>
        <span className="version-info">Version: {item.version.number}</span>
        {item.metadata.updated_at && (
          <span className="last-updated">
            Last updated: {new Date(item.metadata.updated_at).toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
};

export default NameDescriptionManager;

/**
 * NameDescriptionManager - Using Global Language Toggle
 *
 * Manages collections of name/description objects (Character, Organization, Location, Lorebook)
 * Uses global display language from parent (StoryPanel) instead of per-object switching.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import { useAssetStore } from '../store/assetStore';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import RetranslateModal from './RetranslateModal';
import { AssetManagerModal } from './AssetManager';
import { DropdownMenu, DropdownItem, DropdownDivider } from './ui/DropdownMenu';
import { TranslationService } from '../services/translationService';
import type { UnifiedObject, ObjectType } from '../types/unifiedObject';
import type { Asset } from '../api/assetService';
import { API_BASE_URL } from '../api/client';

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
  globalDisplayLanguage: string;
}

const NameDescriptionManager: React.FC<NameDescriptionManagerProps> = ({
  category,
  title,
  singularName,
  pluralName,
  placeholder = { name: 'Enter name', description: 'Enter description' },
  globalDisplayLanguage,
}) => {
  const { projectId } = useParams<{ projectId: string }>();
  const store = useUnifiedObjectStore();
  const listObjects = useUnifiedObjectStore(state => state.listObjects);
  const { settings } = useSettingsStore();
  const { showError, showSuccess } = useErrorStore();
  const translating = useUnifiedObjectStore(state => state.translating);

  const objects = store.objects;
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiEditTargetId, setAiEditTargetId] = useState<string | undefined>(undefined);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | undefined>(undefined);
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [retranslateTargetId, setRetranslateTargetId] = useState<string | undefined>(undefined);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetTargetId, setAssetTargetId] = useState<string | undefined>(undefined);

  // Asset store for story object images
  const {
    fetchStoryObjectAssets,
    getMainAsset,
  } = useAssetStore();

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

  // Expand all items
  const expandAll = () => {
    setExpandedItems(new Set(items.map(item => item.id)));
  };

  // Collapse all items
  const collapseAll = () => {
    setExpandedItems(new Set());
  };

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
          // Always sort by mainLanguage name (not display language) so order stays consistent
          const aData = a.data[settings.mainLanguage] || a.data[Object.keys(a.data)[0]] || { name: '' };
          const bData = b.data[settings.mainLanguage] || b.data[Object.keys(b.data)[0]] || { name: '' };
          return (aData.name || '').localeCompare(bData.name || '');
        }
        return orderA - orderB;
      });
  }, [objects, category, projectId, settings.mainLanguage]);

  // Fetch story object assets when items change
  useEffect(() => {
    if (!projectId || items.length === 0) return;

    // Fetch assets for all items
    items.forEach((item) => {
      fetchStoryObjectAssets(projectId, category, item.id);
    });
  }, [projectId, category, items, fetchStoryObjectAssets]);

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
        settings.mainLanguage
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
      const { effectiveLanguage } = getEffectiveLanguage(item);
      await store.updateObject(category, itemId, {
        data: {
          name: name.trim(),
          description: description.trim(),
        },
        language: effectiveLanguage,
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

  // Helper to compute effective display language with fallback
  const getEffectiveLanguage = (item: NameDescriptionObject) => {
    const available = Object.keys(item.data);
    if (available.includes(globalDisplayLanguage)) {
      return { effectiveLanguage: globalDisplayLanguage, isFallback: false };
    }
    // Fallback to any available language
    return { effectiveLanguage: available[0] || globalDisplayLanguage, isFallback: true };
  };

  // Helper to get data for a specific language with fallback
  const getDataForLanguage = (item: NameDescriptionObject, lang: string): NameDescriptionData => {
    const data = item.data[lang];
    if (data) return data;
    // Fallback to first available language
    const availableLanguages = Object.keys(item.data);
    if (availableLanguages.length > 0) {
      return item.data[availableLanguages[0]] || { name: '', description: '' };
    }
    return { name: '', description: '' };
  };

  const handleRetranslate = async (
    sourceLanguage: string,
    targetLanguage: string,
    includePrevious: boolean,
    userInstructions: string
  ) => {
    if (!projectId || !retranslateTargetId) return;

    const item = store.objects[retranslateTargetId] as NameDescriptionObject;
    if (!item) return;

    try {
      TranslationService.setTranslationStatus(retranslateTargetId, {
        objectId: retranslateTargetId,
        isTranslating: true,
      });

      // Build custom user instructions with optional previous translation
      let instructions = userInstructions || '';

      const availableLanguages = Object.keys(item.data);
      if (includePrevious && availableLanguages.includes(targetLanguage)) {
        const targetData = item.data[targetLanguage] || {};
        const prevTranslation = `Previous translation for reference:\n${JSON.stringify({
          name: targetData.name,
          description: targetData.description,
        }, null, 2)}`;
        instructions = instructions ? `${instructions}\n\n${prevTranslation}` : prevTranslation;
      }

      // Get source data for the source language
      const sourceData = item.data[sourceLanguage] || getDataForLanguage(item, sourceLanguage);
      await TranslationService.translateSingle(
        {
          objectType: category,
          objectId: retranslateTargetId,
          sourceData: {
            name: sourceData.name,
            description: sourceData.description,
          },
        },
        {
          projectId,
          sourceLanguage,
          targetLanguage,
          userInstructions: instructions || undefined,
        }
      );

      // Refresh object to update UI with new translation
      await store.fetchObject(category, retranslateTargetId);

      showSuccess('Success', `Retranslation complete for ${targetLanguage}`);
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
          const { effectiveLanguage } = getEffectiveLanguage(item);
          await store.updateObject(category, aiEditTargetId, {
            data: {
              name: result.name,
              description: result.description,
            },
            language: effectiveLanguage,
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
                const { effectiveLanguage } = getEffectiveLanguage(item);
                await store.updateObject(category, itemResult.id, {
                  data: {
                    name: itemResult.name,
                    description: itemResult.description,
                  },
                  language: effectiveLanguage,
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
      await store.restoreVersion(category, versionHistoryTargetId, versionId);
      console.log('✓ Version restored');
    } catch (error) {
      console.error('Failed to restore version:', error);
      showError('Restore Error', 'Failed to restore version. Please try again.');
    }
  };

  // ============================================================================
  // ASSET MANAGEMENT
  // ============================================================================

  const handleOpenAssetModal = (itemId: string) => {
    setAssetTargetId(itemId);
    setShowAssetModal(true);
  };

  const handleAssetModalClose = () => {
    // Refresh assets when modal closes (in case images were added/changed)
    if (projectId && assetTargetId) {
      fetchStoryObjectAssets(projectId, category, assetTargetId);
    }
    setShowAssetModal(false);
    setAssetTargetId(undefined);
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
            onClick={expandAll}
            className="collapse-control-btn desktop-only"
            title="Expand All"
          >
            ▼ Expand
          </button>
          <button
            onClick={collapseAll}
            className="collapse-control-btn desktop-only"
            title="Collapse All"
          >
            ▶ Collapse
          </button>
          <button
            onClick={() => handleAIEdit()}
            className="ai-edit-button desktop-only"
            disabled={showAddForm}
          >
            🤖 AI Edit All
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="add-button desktop-only"
            disabled={showAddForm}
          >
            Add {singularName}
          </button>
          <DropdownMenu
            trigger={
              <button className="more-button mobile-only" title="More actions">
                •••
              </button>
            }
          >
            <DropdownItem
              icon="▼"
              label="Expand All"
              onClick={expandAll}
            />
            <DropdownItem
              icon="▶"
              label="Collapse All"
              onClick={collapseAll}
            />
            <DropdownDivider />
            <DropdownItem
              icon="🤖"
              label="AI Edit All"
              onClick={() => handleAIEdit()}
              disabled={showAddForm}
            />
            <DropdownItem
              icon="➕"
              label={`Add ${singularName}`}
              onClick={() => setShowAddForm(true)}
              disabled={showAddForm}
            />
          </DropdownMenu>
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

            const { effectiveLanguage, isFallback } = getEffectiveLanguage(item);
            const itemData = getDataForLanguage(item, effectiveLanguage);

            return (
              <div key={item.id} className="item-card">
                {isEditing ? (
                  <EditItemForm
                    itemData={itemData}
                    placeholder={placeholder}
                    onUpdate={(name, desc) => handleUpdate(item.id, name, desc)}
                    onCancel={() => setEditingItemId(null)}
                    onAIEdit={() => handleAIEdit(item.id)}
                    disabled={loading}
                  />
                ) : (
                  <ItemDisplay
                    item={item}
                    itemData={itemData}
                    loading={loading}
                    showSecondaryLanguage={Boolean(settings.defaultSubLanguage)}
                    secondaryLanguage={settings.defaultSubLanguage || undefined}
                    effectiveLanguage={effectiveLanguage}
                    isFallback={isFallback}
                    isExpanded={expandedItems.has(item.id)}
                    mainAsset={getMainAsset(category, item.id)}
                    onToggleExpand={() => toggleItemExpand(item.id)}
                    onEdit={() => setEditingItemId(item.id)}
                    onDelete={() => handleDelete(item.id)}
                    onVersionHistory={() => handleShowVersionHistory(item.id)}
                    onRetranslate={() => {
                      setRetranslateTargetId(item.id);
                      setShowRetranslateModal(true);
                    }}
                    onImageClick={() => handleOpenAssetModal(item.id)}
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

      {retranslateTargetId && (
        <RetranslateModal
          isOpen={showRetranslateModal}
          onClose={() => {
            setShowRetranslateModal(false);
            setRetranslateTargetId(undefined);
          }}
          objectType={category}
          objectId={retranslateTargetId}
          defaultSourceLanguage={settings.mainLanguage}
          defaultTargetLanguage={globalDisplayLanguage}
          availableLanguages={[settings.mainLanguage, ...settings.subLanguages]}
          manuscriptLanguages={store.objects[retranslateTargetId]?.data ? Object.keys(store.objects[retranslateTargetId].data) : []}
          translationTimestamp={store.objects[retranslateTargetId]?.version?.created_at || null}
          onRetranslate={handleRetranslate}
          isTranslating={translating[retranslateTargetId] || false}
        />
      )}

      {assetTargetId && (
        <AssetManagerModal
          isOpen={showAssetModal}
          onClose={handleAssetModalClose}
          objectType={category}
          objectId={assetTargetId}
          title={`Images for ${singularName}`}
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
  itemData: NameDescriptionData;
  placeholder: { name: string; description: string };
  onUpdate: (name: string, description: string) => void;
  onCancel: () => void;
  onAIEdit: () => void;
  disabled?: boolean;
}

const EditItemForm: React.FC<EditItemFormProps> = ({
  itemData,
  placeholder,
  onUpdate,
  onCancel,
  onAIEdit,
  disabled,
}) => {
  const [name, setName] = useState(itemData.name);
  const [description, setDescription] = useState(itemData.description);

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
        <div className="form-actions-split">
          <button type="button" onClick={onAIEdit} className="ai-edit-btn" disabled={disabled}>
            🤖 AI Edit
          </button>
          <div className="form-actions-right">
            <button type="button" onClick={onCancel} className="cancel-button" disabled={disabled}>
              Cancel
            </button>
            <button type="submit" className="save-button" disabled={disabled}>
              {disabled ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

// Item Display Component
interface ItemDisplayProps {
  item: NameDescriptionObject;
  itemData: NameDescriptionData;
  loading: boolean;
  showSecondaryLanguage: boolean;
  secondaryLanguage?: string;
  effectiveLanguage: string;
  isFallback: boolean;
  isExpanded: boolean;
  mainAsset: Asset | null;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onVersionHistory: () => void;
  onRetranslate: () => void;
  onImageClick: () => void;
}

const ItemDisplay: React.FC<ItemDisplayProps> = ({
  item,
  itemData,
  loading,
  showSecondaryLanguage,
  secondaryLanguage,
  effectiveLanguage,
  isFallback,
  isExpanded,
  mainAsset,
  onToggleExpand,
  onEdit,
  onDelete,
  onVersionHistory,
  onRetranslate,
  onImageClick,
}) => {
  const availableLanguages = Object.keys(item.data);
  const hasTranslation = showSecondaryLanguage && secondaryLanguage &&
    availableLanguages.includes(secondaryLanguage);

  return (
    <div className="item-display item-display-with-image">
      {/* Image Placeholder */}
      <button
        className="item-image-placeholder"
        onClick={onImageClick}
        title={mainAsset ? 'Change image' : 'Add image'}
      >
        {mainAsset ? (
          <img
            src={`${API_BASE_URL}${mainAsset.thumbnail_url || mainAsset.file_url}`}
            alt={mainAsset.name}
            className="item-image"
          />
        ) : (
          <span className="image-placeholder-icon">+</span>
        )}
      </button>

      <div className="item-content-wrapper">
        <div className="item-header">
          <button
            className="collapse-toggle"
            onClick={onToggleExpand}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? '▼' : '▶'}
          </button>
          <h4 onClick={onToggleExpand} className="item-name-clickable">{itemData.name}</h4>
        <div className="card-actions">
          <button onClick={onEdit} className="card-edit-btn desktop-only" disabled={loading}>
            Edit
          </button>
          <DropdownMenu
            trigger={
              <button className="more-button" disabled={loading} title="More actions">
                •••
              </button>
            }
          >
            <DropdownItem
              icon="✏️"
              label="Edit"
              onClick={onEdit}
              disabled={loading}
              className="mobile-only"
            />
            {hasTranslation && (
              <DropdownItem
                icon="🔄"
                label="Retranslate"
                onClick={onRetranslate}
                disabled={loading}
              />
            )}
            <DropdownItem
              icon="📚"
              label="History"
              onClick={onVersionHistory}
              disabled={loading}
            />
            <DropdownDivider />
            <DropdownItem
              icon="🗑️"
              label="Delete"
              onClick={onDelete}
              variant="danger"
              disabled={loading}
            />
          </DropdownMenu>
          </div>
        </div>
        {isExpanded && (
          <>
            <div className="item-content">
              <p className="item-description">{itemData.description || 'No description.'}</p>
            </div>
            <div className="item-metadata">
              <span className="item-language">
                {isFallback && <span className="fallback-warning" title="Selected language not available">⚠️ </span>}
                🌐 {effectiveLanguage}
              </span>
              <span className="version-info">v{item.version.number}</span>
              {item.metadata.updated_at && (
                <span className="last-updated">
                  Updated {new Date(item.metadata.updated_at).toLocaleDateString()}
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default NameDescriptionManager;

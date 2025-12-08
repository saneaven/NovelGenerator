/**
 * NameDescriptionManager - Using Global Language Toggle
 *
 * Manages collections of name/description objects (Character, Organization, Location, Lorebook)
 * Uses global display language from parent (StoryPanel) instead of per-object switching.
 *
 * Features:
 * - Motion-powered animations with dynamic grid sizing
 * - Cards span based on image aspect ratio (horizontal/vertical/normal)
 * - Text-only cards have enhanced typography
 * - Edit mode expands card to fill visible viewport
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import { useUnifiedObjectStore } from '../store/unifiedObjectStore';
import { useSettingsStore } from '../store/settingsStore';
import { useErrorStore } from '../store/errorStore';
import { useAssetStore } from '../store/assetStore';
import AIEditModal from './AIEditModal';
import VersionHistoryModal from './VersionHistoryModal';
import TranslationModal from './TranslationModal';
import { AssetManagerModal } from './AssetManager';
import StoryCardExpanded from './StoryCardExpanded';
import { DropdownMenu, DropdownItem, DropdownDivider } from './ui/DropdownMenu';
import { getSpanType, type SpanType } from '../hooks/useCardSpanType';
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
  const { showError } = useErrorStore();

  const objects = store.objects;
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiEditTargetId, setAiEditTargetId] = useState<string | undefined>(undefined);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | undefined>(undefined);
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [retranslateTargetId, setRetranslateTargetId] = useState<string | undefined>(undefined);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetTargetId, setAssetTargetId] = useState<string | undefined>(undefined);

  // Grid ref for layout
  const gridRef = useRef<HTMLDivElement>(null);

  // Asset store for story object images
  // Note: storyObjectAssets subscription triggers re-render when assets are loaded
  const {
    fetchStoryObjectAssets,
    getMainAsset,
    storyObjectAssets,
  } = useAssetStore();

  // 3-state card system:
  // State 1 (collapsed): not in expandedItems
  // State 2 (description visible): in expandedItems
  // State 3 (full edit mode): expandedCardId is set (overlay)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  // Track which card is animating (for z-index elevation) - controlled via animation callbacks
  const [animatingCardId, setAnimatingCardId] = useState<string | null>(null);

  // Toggle between State 1 and State 2 (name click)
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

  // Open full expand overlay (State 3)
  const openFullExpand = (itemId: string) => {
    setAnimatingCardId(itemId);
    setExpandedCardId(itemId);
  };

  // Close full expand overlay
  const closeFullExpand = () => {
    const cardId = expandedCardId;
    setAnimatingCardId(cardId);
    setExpandedCardId(null);
  };

  // Called when card animation completes (from ItemDisplay callbacks)
  const handleAnimationComplete = (cardId: string) => {
    if (animatingCardId === cardId) {
      setAnimatingCardId(null);
    }
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

    // Fire all requests in parallel, don't block render
    items.forEach((item) => {
      fetchStoryObjectAssets(projectId, category, item.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, category, items.length]);

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

      {items.length === 0 ? (
        <div className="empty-state">
          <p>No {pluralName} found.</p>
          <p>Try adding a new {singularName}!</p>
        </div>
      ) : (
        <LayoutGroup id={category}>
          <div
            ref={gridRef}
            className="story-cards-grid"
            style={{ position: 'relative' }}
          >
            {items.map((item) => {
                const isFullExpanded = expandedCardId === item.id;
                const { effectiveLanguage, isFallback } = getEffectiveLanguage(item);
                const itemData = getDataForLanguage(item, effectiveLanguage);
                const mainAsset = getMainAsset(category, item.id);
                const spanType = getSpanType(mainAsset);
                const isExpanded = expandedItems.has(item.id);

                return (
                  <ItemDisplay
                    key={item.id}
                    item={item}
                    itemData={itemData}
                    effectiveLanguage={effectiveLanguage}
                    isFallback={isFallback}
                    isExpanded={isExpanded}
                    isFullExpanded={isFullExpanded}
                    isAnimating={animatingCardId === item.id}
                    mainAsset={mainAsset}
                    spanType={spanType}
                    onToggleExpand={() => toggleItemExpand(item.id)}
                    onOpenFullExpand={() => openFullExpand(item.id)}
                    onAnimationComplete={() => handleAnimationComplete(item.id)}
                  />
                );
              })}
          </div>

          {/* State 3: Full expanded overlay - inside LayoutGroup for animation */}
          <AnimatePresence>
            {expandedCardId && (() => {
              const item = items.find(i => i.id === expandedCardId);
              if (!item) return null;

              const { effectiveLanguage } = getEffectiveLanguage(item);
              const itemData = getDataForLanguage(item, effectiveLanguage);
              const mainAsset = getMainAsset(category, item.id);
              const loading = store.loading[item.id] || false;
              const showSecondaryLanguage = settings.mainLanguage !== globalDisplayLanguage;

              return (
                <motion.div
                  key="expanded-overlay"
                  className="story-card-expanded-container"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <StoryCardExpanded
                    itemId={item.id}
                    itemData={itemData}
                    effectiveLanguage={effectiveLanguage}
                    versionNumber={item.version.number}
                    objectType={category}
                    mainAsset={mainAsset}
                    loading={loading}
                    showSecondaryLanguage={showSecondaryLanguage}
                    onSave={(name, description) => {
                      handleUpdate(item.id, name, description);
                      closeFullExpand();
                    }}
                    onCancel={closeFullExpand}
                    onAIEdit={() => handleAIEdit(item.id)}
                    onVersionHistory={() => handleShowVersionHistory(item.id)}
                    onRetranslate={() => {
                      setRetranslateTargetId(item.id);
                      setShowRetranslateModal(true);
                    }}
                    onDelete={() => {
                      handleDelete(item.id);
                      closeFullExpand();
                    }}
                    onAssetChange={() => {
                      if (projectId) {
                        fetchStoryObjectAssets(projectId, category, item.id);
                      }
                    }}
                  />
                </motion.div>
              );
            })()}
          </AnimatePresence>
        </LayoutGroup>
      )}

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

      {retranslateTargetId && projectId && (
        <TranslationModal
          isOpen={showRetranslateModal}
          onClose={() => {
            setShowRetranslateModal(false);
            setRetranslateTargetId(undefined);
          }}
          projectId={projectId}
          onComplete={() => {
            setShowRetranslateModal(false);
            setRetranslateTargetId(undefined);
          }}
          allowedObjectTypes={[category]}
          preSelectedObjectIds={[retranslateTargetId]}
          defaultSourceLanguage={settings.mainLanguage}
          defaultTargetLanguage={globalDisplayLanguage}
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

// Item Display Component with Motion - 3-state card system
// State 1 & 2 only - State 3 is rendered as overlay
interface ItemDisplayProps {
  item: NameDescriptionObject;
  itemData: NameDescriptionData;
  effectiveLanguage: string;
  isFallback: boolean;
  isExpanded: boolean;        // State 2: description visible
  isFullExpanded: boolean;    // State 3: card is in overlay (hide but keep space)
  isAnimating: boolean;       // Card is animating (needs z-index elevation)
  mainAsset: Asset | null;
  spanType: SpanType;
  onToggleExpand: () => void;      // Toggle State 1 ↔ 2
  onOpenFullExpand: () => void;    // Open State 3 overlay
  onAnimationComplete: () => void; // Called when layout animation completes
}

const ItemDisplay = React.memo<ItemDisplayProps>(({
  item,
  itemData,
  effectiveLanguage,
  isFallback,
  isExpanded,
  isFullExpanded,
  isAnimating,
  mainAsset,
  spanType,
  onToggleExpand,
  onOpenFullExpand,
  onAnimationComplete,
}) => {
  return (
    <motion.article
      layoutId={`card-${item.id}`}
      className="story-card"
      data-expanded={isExpanded}
      data-has-image={Boolean(mainAsset)}
      data-span={spanType}
      style={isAnimating ? { zIndex: 50 } : undefined}
      initial={false}
      animate={{ opacity: isFullExpanded ? 0 : 1 }}
      whileHover={{ y: -4 }}
      transition={{ opacity: { duration: 0.15 } }}
      onAnimationComplete={onAnimationComplete}
    >
      {/* Expand button - top right, always visible */}
      <button
        className="story-card__full-expand-btn"
        onClick={onOpenFullExpand}
        aria-label="Open edit panel"
        title="Edit"
      >
        ▼
      </button>

      {/* Content - DOM order first, z-index: 10 to stay above image */}
      <div className="story-card__content" style={{ zIndex: 10 }}>
        {/* State 1 & 2: Header with clickable name */}
        <header className="story-card__header">
          <motion.h4
            className="story-card__title"
            onClick={onToggleExpand}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && onToggleExpand()}
            layoutId={`card-${item.id}-title`}
          >
            {itemData.name}
          </motion.h4>
        </header>

        {/* State 2: Description visible */}
        {isExpanded && (
          <div className="story-card__description-wrapper">
            <div className="story-card__description-inner">
              <div className="story-card__description">
                <p>{itemData.description || 'No description.'}</p>
              </div>
              <footer className="story-card__metadata">
                <span className="story-card__language">
                  {isFallback && <span className="story-card__fallback-warning" title="Selected language not available">!</span>}
                  {effectiveLanguage}
                </span>
                <span className="story-card__version">v{item.version.number}</span>
                {item.metadata.updated_at && (
                  <span className="story-card__updated">
                    {new Date(item.metadata.updated_at).toLocaleDateString()}
                  </span>
                )}
              </footer>
            </div>
          </div>
        )}
      </div>

      {/* Image - DOM order LAST, z-index: 0 to stay behind content (z-index: 10) */}
      {mainAsset && (
        <motion.div
          layoutId={`card-${item.id}-image`}
          className="story-card__image-container"
          style={{ zIndex: 0 }}
        >
          <img
            src={`${API_BASE_URL}${mainAsset.file_url}`}
            alt={itemData.name}
            className="story-card__image"
            loading="lazy"
          />
        </motion.div>
      )}
    </motion.article>
  );
}, (prevProps, nextProps) => {
  // Custom comparison - only re-render if data props changed
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.version.number === nextProps.item.version.number &&
    prevProps.itemData.name === nextProps.itemData.name &&
    prevProps.itemData.description === nextProps.itemData.description &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isFullExpanded === nextProps.isFullExpanded &&
    prevProps.isAnimating === nextProps.isAnimating &&
    prevProps.effectiveLanguage === nextProps.effectiveLanguage &&
    prevProps.isFallback === nextProps.isFallback &&
    prevProps.mainAsset?.id === nextProps.mainAsset?.id &&
    prevProps.spanType === nextProps.spanType
  );
});

export default NameDescriptionManager;

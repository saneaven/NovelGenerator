/**
 * NameDescriptionManager - Using Global Language Toggle
 *
 * Manages collections of name/description objects (Character, Organization, Location, Lorebook)
 * Uses global display language from parent (StoryObjectPanel) instead of per-object switching.
 *
 * Features:
 * - Motion-powered animations with dynamic grid sizing
 * - Cards span based on image aspect ratio (horizontal/vertical/normal)
 * - Text-only cards have enhanced typography
 * - Edit mode expands card to fill visible viewport
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import './StoryObjectCards/StoryObjectCards.css';
import { motion, AnimatePresence, LayoutGroup } from 'motion/react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableStoryObjectCard } from './StoryObjectCards/SortableStoryObjectCard';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettings } from '../../store/settingsStore';
import { useAssetStore } from '../../store/assetStore';
import AIEditModal from '../Modal/AIEditModal';
import VersionHistoryModal from '../Modal/VersionHistoryModal';
import TranslationModal from '../Modal/TranslationModal';
import { UnifiedImageModal } from '../AssetManager';
import StoryObjectCardExpanded from './StoryObjectCards/StoryObjectCardExpanded';
import { StoryObjectCard } from './StoryObjectCards/StoryObjectCard';
import { DropdownMenu, DropdownItem, DropdownDivider } from '../ui/DropdownMenu';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import { Expand, Collapse, Plus, MoreHorizontal } from '../icons';
import { getSpanType, type SpanType } from '../../hooks/useCardSpanType';
import { useGridColumnCount } from '../../hooks/useGridColumnCount';
import type { UnifiedObject, StoryEntityKind } from '../../types/unifiedObject';
import type { Asset } from '../../api/assetService';
import { getAssetUrl } from '../../utils/assetUrl';
import { confirm, alert as showAlert } from '../../store/dialogStore';


interface NameDescriptionData {
  name: string;
  description: string;  // One-line summary for object indexes
  content: string;      // Full content
}

type NameDescriptionObject = UnifiedObject<NameDescriptionData>;

interface NameDescriptionManagerProps {
  category: StoryEntityKind;
  title: string;
  singularName: string;
  pluralName: string;
  globalDisplayLanguage: string;
}

const NameDescriptionManager: React.FC<NameDescriptionManagerProps> = ({
  category,
  title,
  singularName,
  pluralName,
  globalDisplayLanguage,
}) => {
  const { projectId } = useParams<{ projectId: string }>();
  const store = useUnifiedObjectStore();
  const listObjects = useUnifiedObjectStore(state => state.listObjects);
  const settings = useSettings();
  const objects = store.objects;
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [aiEditTargetId, setAiEditTargetId] = useState<string | null>(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | undefined>(undefined);
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [retranslateTargetId, setRetranslateTargetId] = useState<string | undefined>(undefined);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [assetTargetId, setAssetTargetId] = useState<string | undefined>(undefined);

  // Grid ref for layout
  const gridRef = useRef<HTMLDivElement>(null);

  // Detect grid column count for responsive span adjustments
  const columnCount = useGridColumnCount(gridRef);

  // Asset store for story object images
  const { fetchStoryObjectAssets, getMainAsset } = useAssetStore();

  // DnD sensors for drag-and-drop reordering
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px drag before activating
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200, // 200ms delay before drag starts (to distinguish from scroll)
        tolerance: 5, // 5px movement tolerance during delay
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

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

  // Called when card animation completes (from StoryObjectDisplay callbacks)
  const handleAnimationComplete = (cardId: string) => {
    if (animatingCardId === cardId) {
      setAnimatingCardId(null);
    }
  };

  // Check if all items are collapsed
  const allCollapsed = expandedItems.size === 0;

  // Toggle function: expand all if collapsed, otherwise collapse all
  const toggleAllCards = () => {
    if (allCollapsed) {
      setExpandedItems(new Set(items.map(item => item.id)));
    } else {
      setExpandedItems(new Set());
    }
  };

  // Fetch list of items from backend
  useEffect(() => {
    if (!projectId) return;

    let isCancelled = false;

    const fetchItems = async () => {
      try {
        await listObjects('story_entity', projectId);
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
            obj.type === 'story_entity' &&
            obj.kind === category &&
            obj.metadata?.project_id === projectId
          )
      )
      .sort((a, b) => {
        const orderA = a.metadata.display_order ?? 0;
        const orderB = b.metadata.display_order ?? 0;
        if (orderA === orderB) {
          // Always sort by mainLanguage name (not display language) so order stays consistent
          const aData = a.data[settings.mainLanguage] || a.data[Object.keys(a.data)[0]] || { name: '' };
          const bData = b.data[settings.mainLanguage] || b.data[Object.keys(b.data)[0]] || { name: '' };
          return (aData.name || '').localeCompare(bData.name || '');
        }
        return orderA - orderB;
      });
  }, [objects, category, projectId, settings.mainLanguage]);

  // Handle drag end for reordering
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !projectId) return;

    const oldIndex = items.findIndex(item => item.id === active.id);
    const newIndex = items.findIndex(item => item.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    try {
      const activeItem = items[oldIndex];
      const { effectiveLanguage } = getEffectiveLanguage(activeItem);
      const data = getDataForLanguage(activeItem, effectiveLanguage);
      await store.updateObject('story_entity', activeItem.id, {
        data,
        language: effectiveLanguage,
        metadata: { display_order: newIndex },
        create_new_version: false,
        user_request: 'Reposition story entity',
      });
    } catch (error) {
      console.error('Failed to reorder:', error);
      showAlert({ title: 'Reorder Error', message: 'Failed to reorder items. Please try again.' });
    }
  }, [items, projectId, category, store]);

  // Fetch story object assets when items change
  useEffect(() => {
    if (!projectId || items.length === 0) return;

    // Fire all requests in parallel, don't block render
    items.forEach((item) => {
      fetchStoryObjectAssets(projectId, 'story_entity', item.id);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, category, items.length]);

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  const handleAdd = async (name: string, description: string, content: string) => {
    if (!projectId || !name.trim()) return;

    try {
      await store.createObject(
        'story_entity',
        projectId,
        { name: name.trim(), description: description.trim(), content: content.trim() },
        settings.mainLanguage,
        undefined,
        undefined,
        category,
      );
      setIsCreatingNew(false);
    } catch (error) {
      console.error('Failed to add item:', error);
      showAlert({ title: 'Create Error', message: 'Failed to add item. Please try again.' });
    }
  };

  const handleUpdate = async (itemId: string, name: string, description: string, content: string) => {
    if (!name.trim()) return;

    const item = store.objects[itemId] as NameDescriptionObject;
    if (!item) return;

    try {
      const { effectiveLanguage } = getEffectiveLanguage(item);
      await store.updateObject('story_entity', itemId, {
        data: {
          name: name.trim(),
          description: description.trim(),
          content: content.trim(),
        },
        language: effectiveLanguage,
        user_request: 'User Edit',
        create_new_version: true,
      });
    } catch (error) {
      console.error('Failed to update item:', error);
      showAlert({ title: 'Update Error', message: 'Failed to update. Please try again.' });
    }
  };

  const handleDelete = async (itemId: string) => {
    const confirmed = await confirm({
      title: `Delete ${singularName}`,
      message: `Are you sure you want to delete this ${singularName}?`,
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) {
      return;
    }

    try {
      await store.deleteObject('story_entity', itemId);
    } catch (error) {
      console.error('Failed to delete item:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete. Please try again.' });
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
      return item.data[availableLanguages[0]] || { name: '', description: '', content: '' };
    }
    return { name: '', description: '', content: '' };
  };

  // ============================================================================
  // AI & VERSION MANAGEMENT
  // ============================================================================

  const handleAIEdit = (itemId: string) => {
    setAiEditTargetId(itemId);
    setShowAIModal(true);
  };

  const handleShowVersionHistory = (itemId: string) => {
    setVersionHistoryTargetId(itemId);
    setShowVersionHistory(true);
  };

  // Called after modal restores a version - just refresh the object
  const handleRestoreVersion = async () => {
    if (!versionHistoryTargetId) return;

    try {
      await store.fetchObject('story_entity', versionHistoryTargetId);
    } catch (error) {
      console.error('Failed to refresh after restore:', error);
    }
  };

  // ============================================================================
  // ASSET MANAGEMENT
  // ============================================================================

  const handleAssetModalClose = () => {
    // Refresh assets when modal closes (in case images were added/changed)
    if (projectId && assetTargetId) {
      fetchStoryObjectAssets(projectId, 'story_entity', assetTargetId);
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
          <TextButton
            variant="ghost"
            size="sm"
            onClick={toggleAllCards}
            title={allCollapsed ? "Expand All" : "Collapse All"}
            iconLeft={allCollapsed ? <Collapse size="xs" /> : <Expand size="xs" />}
            className="desktop-only"
          >
            {allCollapsed ? "Expand" : "Collapse"}
          </TextButton>
          <TextButton
            variant="secondary"
            size="sm"
            onClick={() => setIsCreatingNew(true)}
            disabled={isCreatingNew}
            className="desktop-only"
          >
            Add {singularName}
          </TextButton>
          <DropdownMenu
            trigger={
              <IconButton
                icon={<MoreHorizontal size="sm" />}
                title="More actions"
                size="sm"
                className="mobile-only"
              />
            }
          >
            <DropdownItem
              icon={allCollapsed ? <Collapse size="sm" /> : <Expand size="sm" />}
              label={allCollapsed ? "Expand All" : "Collapse All"}
              onClick={toggleAllCards}
            />
            <DropdownDivider />
            <DropdownItem
              icon={<Plus size="sm" />}
              label={`Add ${singularName}`}
              onClick={() => setIsCreatingNew(true)}
              disabled={isCreatingNew}
            />
          </DropdownMenu>
        </div>
      </div>
      <div className="section-divider" />

      {items.length === 0 && !isCreatingNew ? (
        <div className="empty-state">
          <p>No {pluralName} found.</p>
          <p>Try adding a new {singularName}!</p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={items.map(item => item.id)}
            strategy={rectSortingStrategy}
          >
            <LayoutGroup id={`story-entity-${category}`}>
              <div
                ref={gridRef}
                className="story-object-cards-grid"
                style={{ position: 'relative' }}
              >
                {items.map((item) => {
                    const isFullExpanded = expandedCardId === item.id;
                    const { effectiveLanguage } = getEffectiveLanguage(item);
                    const itemData = getDataForLanguage(item, effectiveLanguage);
                    const mainAsset = projectId ? getMainAsset(projectId, 'story_entity', item.id) : null;
                    const baseSpanType = getSpanType(mainAsset);
                    // When only 1 column fits, horizontal cards should not span 2
                    const spanType = (baseSpanType === 'horizontal' && columnCount < 2) ? 'normal' : baseSpanType;
                    const isExpanded = expandedItems.has(item.id);

                    return (
                      <SortableStoryObjectCard key={item.id} id={item.id} disabled={isFullExpanded} spanType={spanType}>
                        {(dragHandle) => (
                          <StoryObjectDisplay
                            item={item}
                            itemData={itemData}
                            isExpanded={isExpanded}
                            isFullExpanded={isFullExpanded}
                            isAnimating={animatingCardId === item.id}
                            mainAsset={mainAsset}
                            spanType={spanType}
                            dragHandle={dragHandle}
                            onToggleExpand={() => toggleItemExpand(item.id)}
                            onOpenFullExpand={() => openFullExpand(item.id)}
                            onAnimationComplete={() => handleAnimationComplete(item.id)}
                          />
                        )}
                      </SortableStoryObjectCard>
                    );
                  })}
              </div>

          {/* State 3: Full expanded overlay - inside LayoutGroup for animation */}
          <AnimatePresence mode="sync">
            {/* Edit existing item */}
            {expandedCardId && (() => {
              const item = items.find(i => i.id === expandedCardId);
              if (!item) return null;

              const { effectiveLanguage } = getEffectiveLanguage(item);
              const itemData = getDataForLanguage(item, effectiveLanguage);
              const mainAsset = projectId ? getMainAsset(projectId, 'story_entity', item.id) : null;
              const loading = store.loading[item.id] || false;
              const showSecondaryLanguage = settings.mainLanguage !== globalDisplayLanguage;

              return (
                <motion.div
                  key="expanded-overlay"
                  className="story-object-card-expanded-container"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.15 } }}
                  transition={{ duration: 0.2 }}
                >
                  <StoryObjectCardExpanded
                    itemId={item.id}
                    itemData={itemData}
                    effectiveLanguage={effectiveLanguage}
                    versionNumber={item.version.number}
                    objectType={category}
                    mainAsset={mainAsset}
                    loading={loading}
                    showSecondaryLanguage={showSecondaryLanguage}
                    onSave={(name, description, content) => {
                      handleUpdate(item.id, name, description, content);
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
                        fetchStoryObjectAssets(projectId, 'story_entity', item.id);
                      }
                    }}
                  />
                </motion.div>
              );
            })()}

            {/* Create new item */}
            {isCreatingNew && (
              <motion.div
                key="new-item-overlay"
                className="story-object-card-expanded-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.15 } }}
                transition={{ duration: 0.2 }}
              >
                <StoryObjectCardExpanded
                  itemId="new"
                  itemData={{ name: '', description: '', content: '' }}
                  effectiveLanguage={settings.mainLanguage}
                  versionNumber={0}
                  objectType={category}
                  mainAsset={null}
                  loading={false}
                  isNewItem={true}
                  onSave={(name, description, content) => {
                    handleAdd(name, description, content);
                  }}
                  onCancel={() => setIsCreatingNew(false)}
                />
              </motion.div>
            )}
            </AnimatePresence>
          </LayoutGroup>
        </SortableContext>
      </DndContext>
      )}

      <AIEditModal
        isOpen={showAIModal}
        onClose={() => {
          setShowAIModal(false);
          setAiEditTargetId(null);
        }}
        category="story_entity"
        projectId={projectId || ''}
        targetId={aiEditTargetId ?? undefined}
      />

      {versionHistoryTargetId && (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => {
            setShowVersionHistory(false);
            setVersionHistoryTargetId(undefined);
          }}
          objectType="story_entity"
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
          preSelectedObjectIds={[retranslateTargetId]}
          defaultSourceLanguage={settings.mainLanguage}
          defaultTargetLanguage={settings.defaultSubLanguage ?? undefined}
        />
      )}

      {assetTargetId && (
        <UnifiedImageModal
          preset="objectManager"
          isOpen={showAssetModal}
          onClose={handleAssetModalClose}
          objectType="story_entity"
          objectId={assetTargetId}
          title={`${singularName} Images`}
        />
      )}
    </div>
  );
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// StoryObjectDisplay — 3-state card system wrapper
// State 1 & 2 only — State 3 is rendered as overlay
interface StoryObjectDisplayProps {
  item: NameDescriptionObject;
  itemData: NameDescriptionData;
  isExpanded: boolean;        // State 2: description visible
  isFullExpanded: boolean;    // State 3: card is in overlay (hide but keep space)
  isAnimating: boolean;       // Card is animating (needs z-index elevation)
  mainAsset: Asset | null;
  spanType: SpanType;
  dragHandle: React.ReactNode;
  onToggleExpand: () => void;      // Toggle State 1 ↔ 2
  onOpenFullExpand: () => void;    // Open State 3 overlay
  onAnimationComplete: () => void; // Called when layout animation completes
}

const StoryObjectDisplay = React.memo<StoryObjectDisplayProps>(({
  item,
  itemData,
  isExpanded,
  isFullExpanded,
  isAnimating,
  mainAsset,
  spanType,
  dragHandle,
  onToggleExpand,
  onOpenFullExpand,
  onAnimationComplete,
}) => {
  const imageUrl = mainAsset ? getAssetUrl(mainAsset) : null;

  return (
    <StoryObjectCard
      name={itemData.name}
      description={itemData.description}
      content={itemData.content}
      imageUrl={imageUrl}
      expanded={isExpanded}
      spanType={spanType}
      dragHandle={dragHandle}
      layoutId={`card-${item.id}`}
      isFullExpanded={isFullExpanded}
      isAnimating={isAnimating}
      onToggleExpand={onToggleExpand}
      onOpenFullExpand={onOpenFullExpand}
      onAnimationComplete={onAnimationComplete}
    />
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.version.number === nextProps.item.version.number &&
    prevProps.itemData.name === nextProps.itemData.name &&
    prevProps.itemData.description === nextProps.itemData.description &&
    prevProps.itemData.content === nextProps.itemData.content &&
    prevProps.isExpanded === nextProps.isExpanded &&
    prevProps.isFullExpanded === nextProps.isFullExpanded &&
    prevProps.isAnimating === nextProps.isAnimating &&
    prevProps.mainAsset?.id === nextProps.mainAsset?.id &&
    prevProps.spanType === nextProps.spanType &&
    prevProps.dragHandle === nextProps.dragHandle
  );
});

export default NameDescriptionManager;

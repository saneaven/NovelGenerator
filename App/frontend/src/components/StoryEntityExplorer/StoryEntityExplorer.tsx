import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useParams } from 'react-router-dom';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useStoryEntityFolderStore } from '../../store/storyEntityFolderStore';
import { useSettings } from '../../store/settingsStore';
import { useAssetStore } from '../../store/assetStore';
import { confirm, alert as showAlert } from '../../store/dialogStore';
import AIEditModal from '../Modal/AIEditModal';
import VersionHistoryModal from '../Modal/VersionHistoryModal';
import TranslationModal from '../Modal/TranslationModal';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { CustomSelect } from '../ui/CustomSelect';
import { DropdownItem, DropdownMenu, DropdownSection } from '../ui/DropdownMenu';
import { SortableStoryObjectCard } from '../StoryObjectManager/StoryObjectCards/SortableStoryObjectCard';
import { StoryObjectCard } from '../StoryObjectManager/StoryObjectCards/StoryObjectCard';
import StoryObjectCardExpanded from '../StoryObjectManager/StoryObjectCards/StoryObjectCardExpanded';
import { useGridColumnCount } from '../../hooks/useGridColumnCount';
import { getSpanType, type SpanType } from '../../hooks/useCardSpanType';
import { getAssetUrl } from '../../utils/assetUrl';
import {
  Books,
  ChevronDown,
  Collapse,
  Expand,
  Folder,
  Map as MapIcon,
  Organization,
  People,
  Plus,
  Save,
  Trash,
} from '../icons';
import type { StoryEntityFolder } from '../../types/storyEntityFolder';
import type { StoryEntityData, StoryEntityKind, StoryEntityObject } from '../../types/unifiedObject';
import './StoryEntityExplorer.css';

interface StoryEntityExplorerProps {
  globalDisplayLanguage: string;
}

type EntityDraftState = {
  kind: StoryEntityKind;
  folderId: string | null;
};

type FolderDialogState = {
  mode: 'create' | 'edit';
  folderId?: string;
  name: string;
  parentId: string | null;
};

type MixedGridItem =
  | {
    kind: 'folder';
    id: string;
    order: number;
    label: string;
    folder: StoryEntityFolder;
    childFolderCount: number;
    childEntityCount: number;
    previewLabels: string[];
  }
  | {
    kind: 'entity';
    id: string;
    order: number;
    label: string;
    entity: StoryEntityObject;
    itemData: StoryEntityData;
    effectiveLanguage: string;
    description: string;
  };

const KIND_ORDER: StoryEntityKind[] = ['character', 'organization', 'location', 'lorebook'];

const KIND_SHORT_LABELS: Record<StoryEntityKind, string> = {
  character: 'Character',
  organization: 'Organization',
  location: 'Location',
  lorebook: 'Lorebook',
};

function sortFolders(a: StoryEntityFolder, b: StoryEntityFolder): number {
  if (a.display_order === b.display_order) {
    return a.name.localeCompare(b.name);
  }
  return a.display_order - b.display_order;
}

function sortEntities(a: StoryEntityObject, b: StoryEntityObject): number {
  const orderA = a.metadata.display_order ?? 0;
  const orderB = b.metadata.display_order ?? 0;
  if (orderA === orderB) {
    return a.id.localeCompare(b.id);
  }
  return orderA - orderB;
}

function buildFolderMap(folders: StoryEntityFolder[]): Record<string, StoryEntityFolder> {
  return folders.reduce<Record<string, StoryEntityFolder>>((acc, folder) => {
    acc[folder.id] = folder;
    return acc;
  }, {});
}

function folderPath(folderId: string | null, foldersById: Record<string, StoryEntityFolder>): StoryEntityFolder[] {
  const result: StoryEntityFolder[] = [];
  let currentId = folderId;
  while (currentId) {
    const folder = foldersById[currentId];
    if (!folder) break;
    result.unshift(folder);
    currentId = folder.parent_id;
  }
  return result;
}

function getEffectiveLanguage(entity: StoryEntityObject, preferredLanguage: string, fallbackLanguage: string): string {
  const availableLanguages = Object.keys(entity.data);
  if (availableLanguages.includes(preferredLanguage)) {
    return preferredLanguage;
  }
  if (availableLanguages.includes(fallbackLanguage)) {
    return fallbackLanguage;
  }
  return availableLanguages[0] ?? preferredLanguage;
}

function getEntityData(entity: StoryEntityObject, language: string): StoryEntityData {
  return entity.data[language]
    || entity.data[Object.keys(entity.data)[0]]
    || { name: '', description: '', content: '' };
}

function kindIcon(kind: StoryEntityKind): React.ReactNode {
  switch (kind) {
    case 'character':
      return <People size="sm" />;
    case 'organization':
      return <Organization size="sm" />;
    case 'location':
      return <MapIcon size="sm" />;
    case 'lorebook':
      return <Books size="sm" />;
  }
}

function getSortableId(item: MixedGridItem): string {
  return `${item.kind}:${item.id}`;
}

const StoryEntityExplorer: React.FC<StoryEntityExplorerProps> = ({ globalDisplayLanguage }) => {
  const { projectId } = useParams<{ projectId: string }>();
  const settings = useSettings();

  const objects = useUnifiedObjectStore((state) => state.objects);
  const loading = useUnifiedObjectStore((state) => state.loading);
  const listObjects = useUnifiedObjectStore((state) => state.listObjects);
  const createObject = useUnifiedObjectStore((state) => state.createObject);
  const updateObject = useUnifiedObjectStore((state) => state.updateObject);
  const deleteObject = useUnifiedObjectStore((state) => state.deleteObject);

  const fetchFolders = useStoryEntityFolderStore((state) => state.fetchFolders);
  const foldersByIdState = useStoryEntityFolderStore((state) => state.foldersById);
  const createFolder = useStoryEntityFolderStore((state) => state.createFolder);
  const renameFolder = useStoryEntityFolderStore((state) => state.renameFolder);
  const moveFolder = useStoryEntityFolderStore((state) => state.moveFolder);
  const moveTreeNode = useStoryEntityFolderStore((state) => state.moveTreeNode);
  const deleteFolder = useStoryEntityFolderStore((state) => state.deleteFolder);

  const fetchStoryObjectAssets = useAssetStore((state) => state.fetchStoryObjectAssets);
  const getMainAsset = useAssetStore((state) => state.getMainAsset);

  const gridRef = useRef<HTMLDivElement>(null);
  const columnCount = useGridColumnCount(gridRef);

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [expandedEntityIds, setExpandedEntityIds] = useState<Set<string>>(new Set());
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(null);
  const [animatingEntityId, setAnimatingEntityId] = useState<string | null>(null);
  const [newEntityDraft, setNewEntityDraft] = useState<EntityDraftState | null>(null);
  const [editingEntityDraft, setEditingEntityDraft] = useState<EntityDraftState | null>(null);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null);
  const [isSavingFolder, setIsSavingFolder] = useState(false);

  const [showAIModal, setShowAIModal] = useState(false);
  const [aiEditTargetId, setAIEditTargetId] = useState<string | undefined>(undefined);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | undefined>(undefined);
  const [showRetranslateModal, setShowRetranslateModal] = useState(false);
  const [retranslateTargetId, setRetranslateTargetId] = useState<string | undefined>(undefined);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    if (!projectId) return;
    void Promise.all([
      listObjects('story_entity', projectId),
      fetchFolders(projectId),
    ]).catch((error) => {
      console.error('Failed to load story entities:', error);
      showAlert({ title: 'Load Error', message: 'Failed to load story entities.' });
    });
  }, [projectId, listObjects, fetchFolders]);

  const folders = useMemo(
    () => Object.values(foldersByIdState).filter((folder) => folder.project_id === projectId).sort(sortFolders),
    [foldersByIdState, projectId],
  );
  const foldersById = useMemo(() => buildFolderMap(folders), [folders]);

  const entities = useMemo(
    () => (
      Object.values(objects)
        .filter((object): object is StoryEntityObject => object.type === 'story_entity' && object.metadata.project_id === projectId)
        .sort(sortEntities)
    ),
    [objects, projectId],
  );

  useEffect(() => {
    if (currentFolderId && !foldersById[currentFolderId]) {
      setCurrentFolderId(null);
    }
  }, [currentFolderId, foldersById]);

  const folderChildren = useMemo(() => {
    const next = new Map<string | null, StoryEntityFolder[]>();
    folders.forEach((folder) => {
      const key = folder.parent_id ?? null;
      const siblings = next.get(key) ?? [];
      siblings.push(folder);
      next.set(key, siblings.sort(sortFolders));
    });
    return next;
  }, [folders]);

  const entitiesByFolder = useMemo(() => {
    const next = new Map<string | null, StoryEntityObject[]>();
    entities.forEach((entity) => {
      const key = entity.metadata.folder_id ?? null;
      const siblings = next.get(key) ?? [];
      siblings.push(entity);
      next.set(key, siblings.sort(sortEntities));
    });
    return next;
  }, [entities]);

  const currentFolderEntities = useMemo(
    () => entitiesByFolder.get(currentFolderId) ?? [],
    [currentFolderId, entitiesByFolder],
  );

  useEffect(() => {
    if (!projectId || currentFolderEntities.length === 0) return;
    currentFolderEntities.forEach((entity) => {
      void fetchStoryObjectAssets(projectId, 'story_entity', entity.id);
    });
  }, [projectId, currentFolderEntities, fetchStoryObjectAssets]);

  const breadcrumbs = useMemo(() => folderPath(currentFolderId, foldersById), [currentFolderId, foldersById]);
  const currentFolder = currentFolderId ? foldersById[currentFolderId] ?? null : null;

  const folderOptions = useMemo(
    () => [
      { id: null as string | null, label: 'Root' },
      ...folders.map((folder) => ({ id: folder.id, label: folderPath(folder.id, foldersById).map((entry) => entry.name).join(' / ') })),
    ],
    [folders, foldersById],
  );

  const storyEntityKindOptions = useMemo(
    () => KIND_ORDER.map((kind) => ({
      value: kind,
      label: KIND_SHORT_LABELS[kind],
    })),
    [],
  );

  const storyEntityFolderSelectOptions = useMemo(
    () => folderOptions.map((option) => ({
      value: option.id ?? '',
      label: option.label,
    })),
    [folderOptions],
  );

  const descendantIdsByFolder = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    const visit = (folderId: string): Set<string> => {
      if (cache.has(folderId)) {
        return cache.get(folderId)!;
      }
      const descendants = new Set<string>();
      for (const child of folderChildren.get(folderId) ?? []) {
        descendants.add(child.id);
        visit(child.id).forEach((id) => descendants.add(id));
      }
      cache.set(folderId, descendants);
      return descendants;
    };
    folders.forEach((folder) => visit(folder.id));
    return cache;
  }, [folderChildren, folders]);

  const currentItems = useMemo<MixedGridItem[]>(() => {
    const childFolders = folderChildren.get(currentFolderId) ?? [];
    const childEntities = entitiesByFolder.get(currentFolderId) ?? [];

    const folderItems = childFolders.map<MixedGridItem>((folder) => {
      const nestedFolders = folderChildren.get(folder.id) ?? [];
      const nestedEntities = entitiesByFolder.get(folder.id) ?? [];
      const previewLabels = [
        ...nestedFolders.map((item) => item.name),
        ...nestedEntities.map((entity) => {
          const language = getEffectiveLanguage(entity, globalDisplayLanguage, settings.mainLanguage);
          return getEntityData(entity, language).name || 'Untitled Entity';
        }),
      ].slice(0, 4);

      return {
        kind: 'folder',
        id: folder.id,
        order: folder.display_order,
        label: folder.name,
        folder,
        childFolderCount: nestedFolders.length,
        childEntityCount: nestedEntities.length,
        previewLabels,
      };
    });

    const entityItems = childEntities.map<MixedGridItem>((entity) => {
      const effectiveLanguage = getEffectiveLanguage(entity, globalDisplayLanguage, settings.mainLanguage);
      const itemData = getEntityData(entity, effectiveLanguage);
      return {
        kind: 'entity',
        id: entity.id,
        order: entity.metadata.display_order ?? 0,
        label: itemData.name || 'Untitled Entity',
        entity,
        itemData,
        effectiveLanguage,
        description: itemData.description || '',
      };
    });

    return [...folderItems, ...entityItems].sort((a, b) => {
      if (a.order === b.order) {
        return a.label.localeCompare(b.label);
      }
      return a.order - b.order;
    });
  }, [currentFolderId, entitiesByFolder, folderChildren, globalDisplayLanguage, settings.mainLanguage]);

  const currentFolderEntityIds = useMemo(
    () => currentItems.filter((item): item is Extract<MixedGridItem, { kind: 'entity' }> => item.kind === 'entity').map((item) => item.id),
    [currentItems],
  );

  const allCollapsed = currentFolderEntityIds.every((id) => !expandedEntityIds.has(id));

  const toggleEntityExpand = useCallback((entityId: string) => {
    setExpandedEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) {
        next.delete(entityId);
      } else {
        next.add(entityId);
      }
      return next;
    });
  }, []);

  const toggleAllCards = useCallback(() => {
    setExpandedEntityIds((prev) => {
      const next = new Set(prev);
      if (currentFolderEntityIds.every((id) => next.has(id))) {
        currentFolderEntityIds.forEach((id) => next.delete(id));
      } else {
        currentFolderEntityIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [currentFolderEntityIds]);

  const openEntityEditor = useCallback((entity: StoryEntityObject) => {
    setAnimatingEntityId(entity.id);
    setExpandedEntityId(entity.id);
    setNewEntityDraft(null);
    setEditingEntityDraft({
      kind: entity.kind ?? 'character',
      folderId: entity.metadata.folder_id ?? null,
    });
  }, []);

  const closeEntityEditor = useCallback(() => {
    if (expandedEntityId) {
      setAnimatingEntityId(expandedEntityId);
    }
    setExpandedEntityId(null);
    setEditingEntityDraft(null);
  }, [expandedEntityId]);

  const handleEntityAnimationComplete = useCallback((entityId: string) => {
    if (animatingEntityId === entityId) {
      setAnimatingEntityId(null);
    }
  }, [animatingEntityId]);

  const openCreateEntity = useCallback((kind: StoryEntityKind = KIND_ORDER[0]) => {
    setExpandedEntityId(null);
    setEditingEntityDraft(null);
    setNewEntityDraft({ kind, folderId: currentFolderId });
  }, [currentFolderId]);

  const handleCreateEntity = useCallback(async (name: string, description: string, content: string) => {
    if (!projectId || !newEntityDraft || !name.trim()) return;
    try {
      await createObject(
        'story_entity',
        projectId,
        { name: name.trim(), description: description.trim(), content: content.trim() },
        settings.mainLanguage,
        { folder_id: newEntityDraft.folderId },
        'User Creation',
        newEntityDraft.kind,
      );
      setNewEntityDraft(null);
    } catch (error) {
      console.error('Failed to create story entity:', error);
      showAlert({ title: 'Create Error', message: 'Failed to create story entity.' });
    }
  }, [createObject, newEntityDraft, projectId, settings.mainLanguage]);

  const handleSaveEntity = useCallback(async (name: string, description: string, content: string) => {
    if (!expandedEntityId || !editingEntityDraft || !name.trim()) return;
    try {
      await updateObject('story_entity', expandedEntityId, {
        kind: editingEntityDraft.kind,
        data: {
          name: name.trim(),
          description: description.trim(),
          content: content.trim(),
        },
        language: globalDisplayLanguage,
        user_request: 'User Edit',
        metadata: {
          folder_id: editingEntityDraft.folderId,
        },
      });
      closeEntityEditor();
    } catch (error) {
      console.error('Failed to save story entity:', error);
      showAlert({ title: 'Save Error', message: 'Failed to save story entity.' });
    }
  }, [closeEntityEditor, editingEntityDraft, expandedEntityId, globalDisplayLanguage, updateObject]);

  const handleDeleteEntity = useCallback(async (entityId: string) => {
    const confirmed = await confirm({
      title: 'Delete Story Entity',
      message: 'Delete this story entity and all of its versions?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    try {
      await deleteObject('story_entity', entityId);
      if (expandedEntityId === entityId) {
        closeEntityEditor();
      }
    } catch (error) {
      console.error('Failed to delete story entity:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete story entity.' });
    }
  }, [closeEntityEditor, deleteObject, expandedEntityId]);

  const openCreateFolderDialog = useCallback(() => {
    setFolderDialog({
      mode: 'create',
      name: '',
      parentId: currentFolderId,
    });
  }, [currentFolderId]);

  const openEditFolderDialog = useCallback((folder: StoryEntityFolder) => {
    setFolderDialog({
      mode: 'edit',
      folderId: folder.id,
      name: folder.name,
      parentId: folder.parent_id ?? null,
    });
  }, []);

  const canSelectFolderParent = useCallback((candidateId: string | null): boolean => {
    if (!folderDialog || folderDialog.mode !== 'edit' || !folderDialog.folderId) return true;
    if (candidateId === folderDialog.folderId) return false;
    if (!candidateId) return true;
    return !descendantIdsByFolder.get(folderDialog.folderId)?.has(candidateId);
  }, [descendantIdsByFolder, folderDialog]);

  const folderParentSelectOptions = useMemo(
    () => folderOptions
      .filter((option) => canSelectFolderParent(option.id))
      .map((option) => ({
        value: option.id ?? '',
        label: option.label,
      })),
    [canSelectFolderParent, folderOptions],
  );

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!projectId || !over || active.id === over.id) return;

    const oldIndex = currentItems.findIndex((item) => getSortableId(item) === active.id);
    const newIndex = currentItems.findIndex((item) => getSortableId(item) === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const targetItem = currentItems[oldIndex];
    try {
      await moveTreeNode(projectId, {
        node_kind: targetItem.kind,
        node_id: targetItem.id,
        new_parent_folder_id: currentFolderId,
        new_index: newIndex,
      });
    } catch (error) {
      console.error('Failed to reorder tree node:', error);
      showAlert({ title: 'Reorder Error', message: 'Failed to reorder item.' });
    }
  }, [currentFolderId, currentItems, moveTreeNode, projectId]);

  const handleSaveFolder = useCallback(async () => {
    if (!projectId || !folderDialog || !folderDialog.name.trim()) return;
    setIsSavingFolder(true);
    try {
      if (folderDialog.mode === 'create') {
        await createFolder(projectId, {
          name: folderDialog.name.trim(),
          parent_id: folderDialog.parentId,
        });
      } else if (folderDialog.folderId) {
        const folder = foldersById[folderDialog.folderId];
        if (!folder) return;
        if (folder.name !== folderDialog.name.trim()) {
          await renameFolder(projectId, folderDialog.folderId, { name: folderDialog.name.trim() });
        }
        if ((folder.parent_id ?? null) !== (folderDialog.parentId ?? null)) {
          await moveFolder(projectId, folderDialog.folderId, { new_parent_id: folderDialog.parentId });
          if (currentFolderId === folderDialog.folderId && folderDialog.parentId === folderDialog.folderId) {
            setCurrentFolderId(null);
          }
        }
      }
      setFolderDialog(null);
    } catch (error) {
      console.error('Failed to save folder:', error);
      showAlert({ title: 'Save Error', message: 'Failed to save folder.' });
    } finally {
      setIsSavingFolder(false);
    }
  }, [createFolder, currentFolderId, folderDialog, foldersById, moveFolder, projectId, renameFolder]);

  const handleDeleteFolder = useCallback(async () => {
    if (!projectId || !folderDialog?.folderId) return;
    const targetFolder = foldersById[folderDialog.folderId];
    if (!targetFolder) return;

    const confirmed = await confirm({
      title: 'Delete Folder',
      message: 'Delete this folder, its descendant folders, and all nested story entities?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;

    try {
      await deleteFolder(projectId, targetFolder.id);
      if (currentFolderId === targetFolder.id) {
        setCurrentFolderId(targetFolder.parent_id ?? null);
      }
      setFolderDialog(null);
    } catch (error) {
      console.error('Failed to delete folder:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete folder.' });
    }
  }, [currentFolderId, deleteFolder, folderDialog, foldersById, projectId]);

  const currentExpandedEntity = expandedEntityId
    ? entities.find((entity) => entity.id === expandedEntityId) ?? null
    : null;

  if (!projectId) {
    return (
      <div className="story-entity-manager">
        <div className="empty-state">
          <p>Project ID not found.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="story-entity-manager">
      <div className="section-header story-entity-manager__header">
        <div className="story-entity-manager__heading">
          <h2>{currentFolder ? currentFolder.name : 'Story Entities'}</h2>
          <div className="story-entity-breadcrumbs">
            <button type="button" className="story-entity-breadcrumb" onClick={() => setCurrentFolderId(null)}>
              Root
            </button>
            {breadcrumbs.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className="story-entity-breadcrumb"
                onClick={() => setCurrentFolderId(folder.id)}
              >
                {folder.name}
              </button>
            ))}
          </div>
        </div>

        <div className="header-buttons story-entity-manager__actions">
          {currentFolderEntityIds.length > 0 ? (
            <TextButton
              variant="ghost"
              size="sm"
              onClick={toggleAllCards}
              title={allCollapsed ? 'Expand All' : 'Collapse All'}
              iconLeft={allCollapsed ? <Collapse size="xs" /> : <Expand size="xs" />}
            >
              {allCollapsed ? 'Expand' : 'Collapse'}
            </TextButton>
          ) : null}

          {currentFolder ? (
            <TextButton
              variant="ghost"
              size="sm"
              onClick={() => openEditFolderDialog(currentFolder)}
            >
              Edit Folder
            </TextButton>
          ) : null}

          <DropdownMenu
            align="right"
            trigger={(
              <TextButton
                variant="secondary"
                size="sm"
                iconLeft={<Plus size="xs" />}
                iconRight={<ChevronDown size="xs" />}
              >
                Add
              </TextButton>
            )}
          >
            <DropdownSection>
              <DropdownItem
                icon={<Folder size="sm" />}
                label="Add Folder"
                onClick={openCreateFolderDialog}
              />
              <DropdownItem
                icon={<Plus size="sm" />}
                label="Add Entity"
                onClick={() => openCreateEntity()}
              />
            </DropdownSection>
          </DropdownMenu>
        </div>
      </div>

      <div className="section-divider" />

      {currentItems.length === 0 ? (
        <div className="empty-state">
          <p>No folders or entities here.</p>
          <p>Create a folder or add a new story entity in this location.</p>
        </div>
      ) : (
        <LayoutGroup id={`story-entities-${currentFolderId ?? 'root'}`}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={currentItems.map(getSortableId)}
              strategy={rectSortingStrategy}
            >
              <div
                ref={gridRef}
                className="story-object-cards-grid story-entity-cards-grid"
                style={{ position: 'relative' }}
              >
                {currentItems.map((item) => {
                  if (item.kind === 'folder') {
                    return (
                      <SortableStoryObjectCard key={getSortableId(item)} id={getSortableId(item)} spanType="normal">
                        {(dragHandle) => (
                          <FolderCard
                            folder={item.folder}
                            childFolderCount={item.childFolderCount}
                            childEntityCount={item.childEntityCount}
                            previewLabels={item.previewLabels}
                            dragHandle={dragHandle}
                            onOpen={() => setCurrentFolderId(item.folder.id)}
                            onEdit={() => openEditFolderDialog(item.folder)}
                          />
                        )}
                      </SortableStoryObjectCard>
                    );
                  }

                  const mainAsset = getMainAsset(projectId, 'story_entity', item.entity.id);
                  const baseSpanType = getSpanType(mainAsset);
                  const spanType = (baseSpanType === 'horizontal' && columnCount < 2) ? 'normal' : baseSpanType;

                  return (
                    <SortableStoryObjectCard key={getSortableId(item)} id={getSortableId(item)} spanType={spanType} disabled={expandedEntityId === item.entity.id}>
                      {(dragHandle) => (
                        <EntityCard
                          entity={item.entity}
                          itemData={item.itemData}
                          description={item.description}
                          imageUrl={mainAsset ? getAssetUrl(mainAsset) : null}
                          spanType={spanType}
                          dragHandle={dragHandle}
                          isExpanded={expandedEntityIds.has(item.entity.id)}
                          isFullExpanded={expandedEntityId === item.entity.id}
                          isAnimating={animatingEntityId === item.entity.id}
                          onToggleExpand={() => toggleEntityExpand(item.entity.id)}
                          onOpenFullExpand={() => openEntityEditor(item.entity)}
                          onAnimationComplete={() => handleEntityAnimationComplete(item.entity.id)}
                        />
                      )}
                    </SortableStoryObjectCard>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          <AnimatePresence mode="sync">
            {currentExpandedEntity && editingEntityDraft ? (
              <motion.div
                key={`entity-overlay-${currentExpandedEntity.id}`}
                className="story-object-card-expanded-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.15 } }}
                transition={{ duration: 0.2 }}
              >
                <StoryObjectCardExpanded
                  itemId={currentExpandedEntity.id}
                  itemData={getEntityData(
                    currentExpandedEntity,
                    getEffectiveLanguage(currentExpandedEntity, globalDisplayLanguage, settings.mainLanguage),
                  )}
                  effectiveLanguage={getEffectiveLanguage(currentExpandedEntity, globalDisplayLanguage, settings.mainLanguage)}
                  versionNumber={currentExpandedEntity.version.number}
                  objectType="story_entity"
                  mainAsset={getMainAsset(projectId, 'story_entity', currentExpandedEntity.id)}
                  loading={loading[currentExpandedEntity.id] || false}
                  showSecondaryLanguage={getEffectiveLanguage(currentExpandedEntity, globalDisplayLanguage, settings.mainLanguage) !== globalDisplayLanguage}
                  extraEditFields={(
                    <div className="story-entity-overlay-fields">
                      <div className="expanded-field">
                        <label>Kind</label>
                        <CustomSelect
                          value={editingEntityDraft.kind}
                          onChange={(event) => setEditingEntityDraft((prev) => prev ? {
                            ...prev,
                            kind: event as StoryEntityKind,
                          } : prev)}
                          options={storyEntityKindOptions}
                        />
                      </div>

                      <div className="expanded-field">
                        <label>Parent Folder</label>
                        <CustomSelect
                          value={editingEntityDraft.folderId ?? ''}
                          onChange={(value) => setEditingEntityDraft((prev) => prev ? {
                            ...prev,
                            folderId: value || null,
                          } : prev)}
                          options={storyEntityFolderSelectOptions}
                        />
                      </div>
                    </div>
                  )}
                  onSave={handleSaveEntity}
                  onCancel={closeEntityEditor}
                  onAIEdit={() => {
                    setAIEditTargetId(currentExpandedEntity.id);
                    setShowAIModal(true);
                  }}
                  onVersionHistory={() => {
                    setVersionHistoryTargetId(currentExpandedEntity.id);
                    setShowVersionHistory(true);
                  }}
                  onRetranslate={() => {
                    setRetranslateTargetId(currentExpandedEntity.id);
                    setShowRetranslateModal(true);
                  }}
                  onDelete={() => {
                    void handleDeleteEntity(currentExpandedEntity.id);
                  }}
                  onAssetChange={() => {
                    void fetchStoryObjectAssets(projectId, 'story_entity', currentExpandedEntity.id, true);
                  }}
                />
              </motion.div>
            ) : null}

            {newEntityDraft ? (
              <motion.div
                key={`new-entity-overlay-${newEntityDraft.kind}`}
                className="story-object-card-expanded-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.15 } }}
                transition={{ duration: 0.2 }}
              >
                <StoryObjectCardExpanded
                  itemId="new-story-entity"
                  itemData={{ name: '', description: '', content: '' }}
                  effectiveLanguage={settings.mainLanguage}
                  versionNumber={0}
                  objectType="story_entity"
                  mainAsset={null}
                  loading={false}
                  isNewItem={true}
                  extraEditFields={(
                    <div className="story-entity-overlay-fields">
                      <div className="expanded-field">
                        <label>Kind</label>
                        <CustomSelect
                          value={newEntityDraft.kind}
                          onChange={(value) => setNewEntityDraft((prev) => prev ? {
                            ...prev,
                            kind: value as StoryEntityKind,
                          } : prev)}
                          options={storyEntityKindOptions}
                        />
                      </div>

                      <div className="expanded-field">
                        <label>Parent Folder</label>
                        <CustomSelect
                          value={newEntityDraft.folderId ?? ''}
                          onChange={(value) => setNewEntityDraft((prev) => prev ? {
                            ...prev,
                            folderId: value || null,
                          } : prev)}
                          options={storyEntityFolderSelectOptions}
                        />
                      </div>
                    </div>
                  )}
                  onSave={handleCreateEntity}
                  onCancel={() => setNewEntityDraft(null)}
                />
              </motion.div>
            ) : null}

            {folderDialog ? (
              <motion.div
                key={`folder-dialog-${folderDialog.mode}-${folderDialog.folderId ?? 'new'}`}
                className="story-object-card-expanded-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ duration: 0.2 }}
              >
                <div className="story-entity-folder-editor">
                  <div className="story-entity-folder-editor__header">
                    <div>
                      <h3>{folderDialog.mode === 'create' ? 'New Folder' : 'Edit Folder'}</h3>
                      <p>Folders live in the same collection as story entity cards.</p>
                    </div>

                    {folderDialog.mode === 'edit' && folderDialog.folderId ? (
                      <IconButton
                        icon={<Trash size="sm" />}
                        onClick={handleDeleteFolder}
                        title="Delete folder"
                        size="sm"
                        variant="ghost"
                      />
                    ) : null}
                  </div>

                  <div className="story-entity-folder-editor__body">
                    <label className="story-entity-folder-editor__field">
                      <span>Name</span>
                      <input
                        type="text"
                        value={folderDialog.name}
                        onChange={(event) => setFolderDialog((prev) => prev ? {
                          ...prev,
                          name: event.target.value,
                        } : prev)}
                        placeholder="Folder name"
                      />
                    </label>

                    <label className="story-entity-folder-editor__field">
                      <span>Parent Folder</span>
                      <CustomSelect
                        value={folderDialog.parentId ?? ''}
                        onChange={(value) => {
                          const nextId = value || null;
                          if (!canSelectFolderParent(nextId)) return;
                          setFolderDialog((prev) => prev ? {
                            ...prev,
                            parentId: nextId,
                          } : prev);
                        }}
                        options={folderParentSelectOptions}
                      />
                    </label>
                  </div>

                  <div className="story-entity-folder-editor__actions">
                    <TextButton
                      variant="ghost"
                      size="sm"
                      onClick={() => setFolderDialog(null)}
                    >
                      Cancel
                    </TextButton>
                    <TextButton
                      variant="primary"
                      size="sm"
                      onClick={handleSaveFolder}
                      loading={isSavingFolder}
                      disabled={!folderDialog.name.trim()}
                      iconLeft={<Save size="xs" />}
                    >
                      Save Folder
                    </TextButton>
                  </div>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </LayoutGroup>
      )}

      <AIEditModal
        isOpen={showAIModal}
        onClose={() => {
          setShowAIModal(false);
          setAIEditTargetId(undefined);
        }}
        category="story_entity"
        projectId={projectId}
        targetId={aiEditTargetId}
      />

      {versionHistoryTargetId ? (
        <VersionHistoryModal
          isOpen={showVersionHistory}
          onClose={() => {
            setShowVersionHistory(false);
            setVersionHistoryTargetId(undefined);
          }}
          objectType="story_entity"
          objectId={versionHistoryTargetId}
        />
      ) : null}

      {retranslateTargetId ? (
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
      ) : null}
    </div>
  );
};

const EntityCard: React.FC<{
  entity: StoryEntityObject;
  itemData: StoryEntityData;
  description: string;
  imageUrl: string | null;
  spanType: SpanType;
  dragHandle: React.ReactNode;
  isExpanded: boolean;
  isFullExpanded: boolean;
  isAnimating: boolean;
  onToggleExpand: () => void;
  onOpenFullExpand: () => void;
  onAnimationComplete: () => void;
}> = ({
  entity,
  itemData,
  description,
  imageUrl,
  spanType,
  dragHandle,
  isExpanded,
  isFullExpanded,
  isAnimating,
  onToggleExpand,
  onOpenFullExpand,
  onAnimationComplete,
}) => (
  <div className="story-entity-grid-item" data-span={spanType}>
    <div className="story-entity-card-shell">
      <span className="story-entity-card-kind-badge">
        {kindIcon(entity.kind ?? 'character')}
        {KIND_SHORT_LABELS[entity.kind ?? 'character']}
      </span>

      <StoryObjectCard
        name={itemData.name}
        description={description}
        content={itemData.content}
        imageUrl={imageUrl}
        expanded={isExpanded}
        spanType={spanType}
        className="story-entity-card"
        dragHandle={dragHandle}
        layoutId={`card-${entity.id}`}
        isFullExpanded={isFullExpanded}
        isAnimating={isAnimating}
        onToggleExpand={onToggleExpand}
        onOpenFullExpand={onOpenFullExpand}
        onAnimationComplete={onAnimationComplete}
      />
    </div>
  </div>
);

const FolderCard: React.FC<{
  folder: StoryEntityFolder;
  childFolderCount: number;
  childEntityCount: number;
  previewLabels: string[];
  dragHandle: React.ReactNode;
  onOpen: () => void;
  onEdit: () => void;
}> = ({
  folder,
  childFolderCount,
  childEntityCount,
  previewLabels,
  dragHandle,
  onOpen,
  onEdit,
}) => (
  <div className="story-entity-grid-item" data-span="normal">
    <article className="story-object-card story-entity-folder-card" data-has-image="false" data-span="normal">
      <span className="story-entity-card-kind-badge story-entity-card-kind-badge--folder">
        <Folder size="sm" />
        Folder
      </span>

      <div className="story-object-card__content">
        <div className="story-object-card__drag-slot">
          {dragHandle}
        </div>
        <div className="story-object-card__body-shell">
          <header className="story-object-card__header">
            <h4
              className="story-object-card__title story-object-card__title--no-toggle"
              onClick={onOpen}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpen();
                }
              }}
            >
              {folder.name}
            </h4>
            <p className="story-object-card__subtitle">
              {childFolderCount} folders · {childEntityCount} entities
            </p>
          </header>

          <div className="story-object-card__description-wrapper story-entity-folder-card__description-wrapper">
            <div className="story-object-card__description">
              {previewLabels.length > 0 ? (
                <ul className="story-entity-folder-card__preview-list">
                  {previewLabels.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ul>
              ) : (
                <p className="story-entity-folder-card__empty">Empty folder.</p>
              )}
            </div>
          </div>

          <div className="story-entity-folder-card__footer">
            <TextButton variant="secondary" size="sm" onClick={onOpen}>
              Open Folder
            </TextButton>
            <TextButton variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </TextButton>
          </div>
        </div>
      </div>
    </article>
  </div>
);

export default StoryEntityExplorer;

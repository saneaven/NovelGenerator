import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import { useDndSensors } from '../../hooks/useDndSensors';
import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useParams } from 'react-router-dom';
import { useStoryEntityTreeQuery } from '../../data/objects/useStoryEntityTreeQuery';
import { useCreateObjectMutation } from '../../data/objects/mutations/useCreateObjectMutation';
import { useUpdateObjectMutation } from '../../data/objects/mutations/useUpdateObjectMutation';
import { useDeleteObjectMutation } from '../../data/objects/mutations/useDeleteObjectMutation';
import { usePatchObjectStructureMutation } from '../../data/objects/mutations/usePatchObjectStructureMutation';
import { useSettings } from '../../store/settingsStore';
import { useAssetStore } from '../../store/assetStore';
import { confirm, alert as showAlert } from '../../store/dialogStore';
import AIEditModal from '../Modal/AIEditModal';
import VersionHistoryModal from '../Modal/VersionHistoryModal';
import TranslationModal from '../Modal/TranslationModal';
import { TextButton } from '../TextButton';
import { IconButton } from '../IconButton';
import { CustomSelect } from '../ui/CustomSelect';
import { DropdownMenu, DropdownItem } from '../ui/DropdownMenu';
import { SortableObjectCard } from '../ObjectManager/ObjectCards/SortableObjectCard';
import { ObjectCard } from '../ObjectManager/ObjectCards/ObjectCard';
import ObjectCardExpanded from '../ObjectManager/ObjectCards/ObjectCardExpanded';
import { useGridColumnCount } from '../../hooks/useGridColumnCount';
import { getSpanType, type SpanType } from '../../hooks/useCardSpanType';
import { getAssetUrl } from '../../utils/assetUrl';
import {
  Books,
  ChevronRight,
  Collapse,
  Edit,
  Expand,
  Folder,
  Map as MapIcon,
  MoreHorizontal,
  Organization,
  People,
  Plus,
  Trash,
} from '../icons';
import {
  getStoryEntityFolderDescription,
  getStoryEntityFolderName,
  type StoryEntityFolder,
} from '../../types/storyEntityFolder';
import type { TipTapDoc } from '../../types/tiptap';
import type { StoryEntityData, StoryEntityKind, StoryEntityObject, UnifiedObject } from '../../types/unifiedObject';
import type { ObjectAssetLink } from '../../api/assetService';
import { emptyDoc, normalizeDoc } from '../../editor/manuscript/doc';
import {
  requestedLanguageStateFromProjection,
  resolveTranslationSourceLanguage,
  type RequestedLanguageState,
} from '../../utils/requestedLanguage';
import {
  applyStoryEntityStructurePatch,
  buildFolderPathLabel,
} from '../../utils/storyEntityTree';
import FolderTreeContent from './FolderTreeContent';
import StoryEntityGridSkeleton from './StoryEntityGridSkeleton';
import './StoryEntityExplorer.css';

interface StoryEntityExplorerProps {
  globalDisplayLanguage: string;
  selectedFolderId?: string | null;
  onSelectFolder?: (folderId: string | null) => void;
}

type EntityDraftState = {
  kind: StoryEntityKind;
  folderId: string | null;
};

type FolderGridItem = {
  type: 'folder';
  id: string;
  sortId: string;
  folder: StoryEntityFolder;
  order: number;
  name: string;
  description: string;
};

type EntityGridItem = {
  type: 'entity';
  id: string;
  sortId: string;
  order: number;
  label: string;
  entity: StoryEntityObject;
  itemData: StoryEntityData;
  languageState: RequestedLanguageState;
  description: string;
};

type GridItem = FolderGridItem | EntityGridItem;

const KIND_ORDER: StoryEntityKind[] = ['character', 'organization', 'location', 'lorebook'];

const KIND_SHORT_LABELS: Record<StoryEntityKind, string> = {
  character: 'Character',
  organization: 'Organization',
  location: 'Location',
  lorebook: 'Lorebook',
};

function makeSortEntities(language: string, mainLanguage: string) {
  return (a: StoryEntityObject, b: StoryEntityObject): number => {
    const orderA = a.metadata.display_order ?? 0;
    const orderB = b.metadata.display_order ?? 0;
    if (orderA === orderB) {
      const nameA = getEntityData(a, language).name || getEntityData(a, mainLanguage).name || '';
      const nameB = getEntityData(b, language).name || getEntityData(b, mainLanguage).name || '';
      return nameA.localeCompare(nameB);
    }
    return orderA - orderB;
  };
}

function getEntityLanguageState(
  entity: StoryEntityObject,
  mainLanguage: string,
): RequestedLanguageState {
  return requestedLanguageStateFromProjection(entity.language_state, mainLanguage);
}

function getEntityData(entity: StoryEntityObject, _language: string): StoryEntityData {
  return entity.data || { name: '', description: '', content: emptyDoc() };
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

function getMainAssetFromLinks(links: ObjectAssetLink[] | undefined) {
  return links?.find((entry) => entry.is_main)?.asset ?? null;
}

const StoryEntityExplorer: React.FC<StoryEntityExplorerProps> = ({
  globalDisplayLanguage,
  selectedFolderId = null,
  onSelectFolder,
}) => {
  const { projectId } = useParams<{ projectId: string }>();
  const settings = useSettings();

  // TipTap-format tree feeds the editor (entity.data.content is a TipTap doc);
  // the markdown-format sibling supplies rendered card previews (replaces
  // the old getRichTextMarkdown cache).
  const tree = useStoryEntityTreeQuery(projectId, globalDisplayLanguage);
  const treeMarkdown = useStoryEntityTreeQuery(projectId, globalDisplayLanguage, 'markdown');
  const showSkeleton = tree.isLoading;

  const createObjectMutation = useCreateObjectMutation();
  const updateObjectMutation = useUpdateObjectMutation();
  const deleteObjectMutation = useDeleteObjectMutation();
  const patchObjectStructureMutation = usePatchObjectStructureMutation();

  // Optimistic overlay for drag-and-drop reorder/move. While a structure patch
  // is in flight we render this locally-patched objects Record for instant
  // feedback, then clear it once the tree query refetches the server truth.
  const [optimisticObjects, setOptimisticObjects] = useState<Record<string, UnifiedObject> | null>(null);

  const serverObjects = useMemo<Record<string, UnifiedObject>>(() => {
    const folders = tree.data?.folders ?? [];
    const entities = tree.data?.entities ?? [];
    return Object.fromEntries([...folders, ...entities].map((o) => [o.id, o]));
  }, [tree.data]);

  // Clear the optimistic overlay whenever fresh server data arrives.
  useEffect(() => {
    setOptimisticObjects(null);
  }, [serverObjects]);

  const objects = optimisticObjects ?? serverObjects;

  // Rendered-markdown content keyed by entity id, from the markdown-format tree.
  const markdownContentByEntityId = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const entity of treeMarkdown.data?.entities ?? []) {
      const content = (entity.data as { content?: unknown } | undefined)?.content;
      if (typeof content === 'string') {
        map[entity.id] = content;
      }
    }
    return map;
  }, [treeMarkdown.data]);

  const fetchObjectAssetLinks = useAssetStore((state) => state.fetchObjectAssetLinks);
  const objectAssetsByKey = useAssetStore((state) => state.objectAssetsByKey);

  const gridRef = useRef<HTMLDivElement>(null);
  const columnCount = useGridColumnCount(gridRef);

  const [expandedEntityIds, setExpandedEntityIds] = useState<Set<string>>(new Set());
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(null);
  const [animatingEntityId, setAnimatingEntityId] = useState<string | null>(null);
  const [newEntityDraft, setNewEntityDraft] = useState<EntityDraftState | null>(null);
  const [editingEntityDraft, setEditingEntityDraft] = useState<EntityDraftState | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderDescription, setNewFolderDescription] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [renameFolderDescription, setRenameFolderDescription] = useState('');

  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const [showAIModal, setShowAIModal] = useState(false);
  const [aiEditTargetId, setAIEditTargetId] = useState<string | undefined>(undefined);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistoryTargetId, setVersionHistoryTargetId] = useState<string | undefined>(undefined);
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [translationTargetId, setTranslationTargetId] = useState<string | undefined>(undefined);

  const sensors = useDndSensors();

  const folderAwareCollision = useCallback((args: Parameters<typeof closestCenter>[0]) => {
    const activeId = String(args.active.id);
    const pointerCollisions = pointerWithin(args);
    const folderCollision = pointerCollisions.find((c) => {
      const cid = String(c.id);
      if (cid === 'drop-parent-folder') return true;
      if (cid.startsWith('drop-folder:')) {
        // Don't drop a folder into itself
        const targetFolderId = cid.slice('drop-folder:'.length);
        return activeId !== `folder:${targetFolderId}`;
      }
      return false;
    });
    if (folderCollision) return [folderCollision];
    return closestCenter(args);
  }, []);

  const isMainLanguageView = globalDisplayLanguage === settings.mainLanguage;

  const openTranslationModalForTarget = useCallback((targetId: string) => {
    setTranslationTargetId(targetId);
    setShowTranslationModal(true);
  }, []);

  useEffect(() => {
    setIsCreatingFolder(false);
    setNewFolderName('');
    setNewFolderDescription('');
    setRenamingFolderId(null);
    setRenameFolderValue('');
    setRenameFolderDescription('');
  }, [selectedFolderId]);

  const sortEntities = useMemo(() => makeSortEntities(globalDisplayLanguage, settings.mainLanguage), [globalDisplayLanguage, settings.mainLanguage]);

  const folders = useMemo(
    () => Object.values(objects).filter(
      (o): o is StoryEntityFolder => o.type === 'story_entity_folder',
    ),
    [objects],
  );

  const foldersById = useMemo(
    () => folders.reduce<Record<string, StoryEntityFolder>>((acc, f) => { acc[f.id] = f; return acc; }, {}),
    [folders],
  );
  const entities = useMemo(
    () => Object.values(objects)
      .filter((o): o is StoryEntityObject => o.type === 'story_entity')
      .sort(sortEntities),
    [objects, sortEntities],
  );

  const effectiveFolderId = selectedFolderId;

  const filteredEntities = useMemo(() => {
    return entities.filter((e) => e.metadata.folder_id === effectiveFolderId);
  }, [entities, effectiveFolderId]);

  const childFolders = useMemo(() => {
    return folders
      .filter((f) => (f.metadata.parent_id ?? null) === effectiveFolderId)
      .sort((a, b) => (a.metadata.display_order ?? 0) - (b.metadata.display_order ?? 0));
  }, [folders, effectiveFolderId]);

  const parentInfo = useMemo(() => {
    if (!effectiveFolderId) return null;
    const currentFolder = foldersById[effectiveFolderId];
    if (!currentFolder) return null;
    const pid = currentFolder.metadata.parent_id ?? null;
    const parentName = pid && foldersById[pid]
      ? getStoryEntityFolderName(foldersById[pid], globalDisplayLanguage, settings.mainLanguage)
      : 'Root';
    return { parentId: pid, parentName };
  }, [effectiveFolderId, foldersById, globalDisplayLanguage, settings.mainLanguage]);

  const mainAssetsByEntityId = useMemo(() => {
    if (!projectId) return {};
    return filteredEntities.reduce<Record<string, ReturnType<typeof getMainAssetFromLinks>>>((acc, entity) => {
      acc[entity.id] = getMainAssetFromLinks(objectAssetsByKey[`${projectId}:story_entity:${entity.id}`]);
      return acc;
    }, {});
  }, [filteredEntities, projectId, objectAssetsByKey]);

  useEffect(() => {
    if (!projectId || filteredEntities.length === 0) return;
    filteredEntities.forEach((entity) => {
      void fetchObjectAssetLinks(projectId, 'story_entity', entity.id);
    });
  }, [projectId, filteredEntities, fetchObjectAssetLinks]);

  // Folder options for entity editor's "Parent Folder" dropdown
  const folderOptions = useMemo(
    () => {
      const buildFolderPath = (folderId: string): string => {
        return buildFolderPathLabel(folderId, foldersById, globalDisplayLanguage, settings.mainLanguage);
      };
      return [
        { value: '', label: 'Root' },
        ...folders.map((f) => ({
          value: f.id,
          label: buildFolderPath(f.id),
        })),
      ];
    },
    [folders, foldersById, globalDisplayLanguage, settings.mainLanguage],
  );

  const storyEntityKindOptions = useMemo(
    () => KIND_ORDER.map((kind) => ({
      value: kind,
      label: KIND_SHORT_LABELS[kind],
    })),
    [],
  );

  const gridItems = useMemo<GridItem[]>(() => {
    const folderItems: GridItem[] = childFolders.map((f) => ({
      type: 'folder' as const,
      id: f.id,
      sortId: `folder:${f.id}`,
      folder: f,
      order: f.metadata.display_order ?? 0,
      name: getStoryEntityFolderName(f, globalDisplayLanguage, settings.mainLanguage),
      description: getStoryEntityFolderDescription(f, globalDisplayLanguage, settings.mainLanguage),
    }));
    const entityItems: GridItem[] = filteredEntities.map((entity) => {
      const languageState = getEntityLanguageState(entity, settings.mainLanguage);
      const itemData = getEntityData(entity, languageState.viewLanguage);
      return {
        type: 'entity' as const,
        id: entity.id,
        sortId: entity.id,
        entity,
        order: entity.metadata.display_order ?? 0,
        label: itemData.name || 'Untitled Entity',
        itemData,
        languageState,
        description: itemData.description || '',
      };
    });
    return [...folderItems, ...entityItems].sort((a, b) => {
      if (a.order === b.order) {
        if (a.type !== b.type) {
          return a.type === 'folder' ? -1 : 1;
        }
        return a.id.localeCompare(b.id);
      }
      return a.order - b.order;
    });
  }, [childFolders, filteredEntities, globalDisplayLanguage, settings.mainLanguage]);

  const currentEntityIds = useMemo(
    () => gridItems.filter((item): item is EntityGridItem => item.type === 'entity').map((item) => item.id),
    [gridItems],
  );

  const allCollapsed = currentEntityIds.every((id) => !expandedEntityIds.has(id));

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
      if (currentEntityIds.every((id) => next.has(id))) {
        currentEntityIds.forEach((id) => next.delete(id));
      } else {
        currentEntityIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }, [currentEntityIds]);

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
    if (!isMainLanguageView) return;
    setExpandedEntityId(null);
    setEditingEntityDraft(null);
    setIsCreatingFolder(false);
    setNewFolderName('');
    setNewEntityDraft({ kind, folderId: effectiveFolderId });
  }, [effectiveFolderId, isMainLanguageView]);

  const openCreateFolder = useCallback(() => {
    if (!isMainLanguageView) return;
    setExpandedEntityId(null);
    setEditingEntityDraft(null);
    setNewEntityDraft(null);
    setRenamingFolderId(null);
    setRenameFolderValue('');
    setRenameFolderDescription('');
    setNewFolderName('');
    setNewFolderDescription('');
    setIsCreatingFolder(true);
  }, [isMainLanguageView]);

  const handleCreateEntity = useCallback(async (name: string, description: string, content: TipTapDoc) => {
    if (!projectId || !newEntityDraft || !name.trim()) return;
    try {
      await createObjectMutation.mutateAsync({
        type: 'story_entity',
        projectId,
        data: { name: name.trim(), description: description.trim(), content: normalizeDoc(content) },
        language: settings.mainLanguage,
        metadata: { folder_id: newEntityDraft.folderId },
        userRequest: 'User Creation',
        kind: newEntityDraft.kind,
      });
      setNewEntityDraft(null);
    } catch (error) {
      console.error('Failed to create story entity:', error);
      showAlert({ title: 'Create Error', message: 'Failed to create story entity.' });
    }
  }, [createObjectMutation, newEntityDraft, projectId, settings.mainLanguage]);

  const handleCreateFolder = useCallback(async () => {
    if (!projectId || !newFolderName.trim()) return;
    try {
      await createObjectMutation.mutateAsync({
        type: 'story_entity_folder',
        projectId,
        data: {
          name: newFolderName.trim(),
          description: newFolderDescription.trim(),
        },
        language: settings.mainLanguage,
        metadata: { parent_id: effectiveFolderId },
        userRequest: 'User Creation',
      });
      setIsCreatingFolder(false);
      setNewFolderName('');
      setNewFolderDescription('');
    } catch (error) {
      console.error('Failed to create story entity folder:', error);
      showAlert({ title: 'Create Error', message: 'Failed to create folder.' });
    }
  }, [createObjectMutation, effectiveFolderId, newFolderDescription, newFolderName, projectId, settings.mainLanguage]);

  const startRenameFolder = useCallback((folder: StoryEntityFolder) => {
    if (!isMainLanguageView) return;
    setIsCreatingFolder(false);
    setNewEntityDraft(null);
    setNewFolderName('');
    setNewFolderDescription('');
    setRenamingFolderId(folder.id);
    setRenameFolderValue(
      getStoryEntityFolderName(folder, globalDisplayLanguage, settings.mainLanguage),
    );
    setRenameFolderDescription(
      getStoryEntityFolderDescription(folder, globalDisplayLanguage, settings.mainLanguage),
    );
  }, [globalDisplayLanguage, isMainLanguageView, settings.mainLanguage]);

  const cancelRenameFolder = useCallback(() => {
    setRenamingFolderId(null);
    setRenameFolderValue('');
    setRenameFolderDescription('');
  }, []);

  const handleRenameFolder = useCallback(async (folderId: string) => {
    if (!renameFolderValue.trim()) {
      cancelRenameFolder();
      return;
    }
    try {
      const folder = foldersById[folderId];
      await updateObjectMutation.mutateAsync({
        type: 'story_entity_folder',
        id: folderId,
        request: {
          language: settings.mainLanguage,
          data: {
            name: renameFolderValue.trim(),
            description: folder
              ? renameFolderDescription.trim()
              : '',
          },
          user_request: 'User Edit',
        },
      });
      cancelRenameFolder();
    } catch (error) {
      console.error('Failed to rename story entity folder:', error);
      showAlert({ title: 'Rename Error', message: 'Failed to rename folder.' });
    }
  }, [cancelRenameFolder, foldersById, renameFolderDescription, renameFolderValue, settings.mainLanguage, updateObjectMutation]);

  const handleSaveEntity = useCallback(async (name: string, description: string, content: TipTapDoc) => {
    if (!projectId || !expandedEntityId || !editingEntityDraft || !name.trim()) return;
    const entity = entities.find((item) => item.id === expandedEntityId);
    if (!entity) return;
    const languageState = getEntityLanguageState(entity, settings.mainLanguage);
    if (!languageState.canEdit) return;
    try {
      await updateObjectMutation.mutateAsync({
        type: 'story_entity',
        id: expandedEntityId,
        request: {
          kind: editingEntityDraft.kind,
          data: {
            name: name.trim(),
            description: description.trim(),
            content: normalizeDoc(content),
          },
          language: languageState.requestedLanguage,
          rich_text_format: 'tiptap',
          user_request: 'User Edit',
          create_new_version: languageState.createNewVersion,
        },
      });
      if ((entity.metadata.folder_id ?? null) !== editingEntityDraft.folderId) {
        await patchObjectStructureMutation.mutateAsync({
          type: 'story_entity',
          id: expandedEntityId,
          metadata: { folder_id: editingEntityDraft.folderId },
        });
      }
      closeEntityEditor();
    } catch (error) {
      console.error('Failed to save story entity:', error);
      showAlert({ title: 'Save Error', message: 'Failed to save story entity.' });
    }
  }, [closeEntityEditor, editingEntityDraft, entities, expandedEntityId, patchObjectStructureMutation, projectId, settings.mainLanguage, updateObjectMutation]);

  const handleDeleteEntity = useCallback(async (entityId: string) => {
    const confirmed = await confirm({
      title: 'Delete Story Entity',
      message: 'Delete this story entity and all of its versions?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    if (!projectId) return;

    try {
      await deleteObjectMutation.mutateAsync({ type: 'story_entity', id: entityId, projectId });
      if (expandedEntityId === entityId) {
        closeEntityEditor();
      }
    } catch (error) {
      console.error('Failed to delete story entity:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete story entity.' });
    }
  }, [closeEntityEditor, deleteObjectMutation, expandedEntityId, projectId]);

  const handleDeleteFolder = useCallback(async (folder: StoryEntityFolder) => {
    const confirmed = await confirm({
      title: 'Delete Folder',
      message: 'Delete this folder, its descendant folders, and all nested story entities?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    if (!projectId) return;

    try {
      await deleteObjectMutation.mutateAsync({ type: 'story_entity_folder', id: folder.id, projectId });
      if (renamingFolderId === folder.id) {
        cancelRenameFolder();
      }
    } catch (error) {
      console.error('Failed to delete story entity folder:', error);
      showAlert({ title: 'Delete Error', message: 'Failed to delete folder.' });
    }
  }, [cancelRenameFolder, deleteObjectMutation, projectId, renamingFolderId]);

  const performStructureMove = useCallback(async (
    objectType: 'story_entity_folder' | 'story_entity',
    objectId: string,
    metadata: Record<string, string | number | null>,
    errorMessage: string,
  ) => {
    if (!projectId) return;
    // Optimistically reorder/move locally for instant feedback. The overlay is
    // cleared when the patch mutation's tree invalidation delivers fresh data.
    const baseObjects = objects;
    setOptimisticObjects(
      applyStoryEntityStructurePatch(baseObjects, projectId, {
        objectType,
        objectId,
        metadata,
      }),
    );

    try {
      await patchObjectStructureMutation.mutateAsync({ type: objectType, id: objectId, metadata });
    } catch (error) {
      setOptimisticObjects(null);
      showAlert({ title: 'Move Error', message: errorMessage });
      throw error;
    }
  }, [objects, patchObjectStructureMutation, projectId]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!projectId || !over) return;

    const overId = String(over.id);
    const activeId = String(active.id);

    // Resolve active item's node_kind and raw ID
    const isActiveFolder = activeId.startsWith('folder:');
    const activeNodeKind = isActiveFolder ? 'folder' : 'entity';
    const activeRawId = isActiveFolder ? activeId.slice('folder:'.length) : activeId;

    // Dropped on a folder card → move item INTO that folder
    if (overId.startsWith('drop-folder:')) {
      const targetFolderId = overId.slice('drop-folder:'.length);
      try {
        await performStructureMove(
          activeNodeKind === 'folder' ? 'story_entity_folder' : 'story_entity',
          activeRawId,
          activeNodeKind === 'folder'
            ? { parent_id: targetFolderId, display_order: 0 }
            : { folder_id: targetFolderId, display_order: 0 },
          'Failed to move item into folder.',
        );
      } catch {
        // handled in performStructureMove
      }
      return;
    }

    // Dropped on parent folder bar → move item to parent folder
    if (overId === 'drop-parent-folder' && parentInfo) {
      try {
        await performStructureMove(
          activeNodeKind === 'folder' ? 'story_entity_folder' : 'story_entity',
          activeRawId,
          activeNodeKind === 'folder'
            ? { parent_id: parentInfo.parentId, display_order: 0 }
            : { folder_id: parentInfo.parentId, display_order: 0 },
          'Failed to move item to parent folder.',
        );
      } catch {
        // handled in performStructureMove
      }
      return;
    }

    // Normal reorder within current folder
    if (active.id === over.id) return;
    const oldIndex = gridItems.findIndex((item) => item.sortId === activeId);
    const newMixedIndex = gridItems.findIndex((item) => item.sortId === overId);
    if (oldIndex === -1 || newMixedIndex === -1) return;

    // gridItems mirrors the backend's mixed sibling list. Reorder by the mixed
    // index so folders/entities share one authoritative display_order space.
    const reordered = arrayMove(gridItems, oldIndex, newMixedIndex);
    const mixedNewIndex = reordered.findIndex((gi) => gi.sortId === activeId);

    try {
      await performStructureMove(
        activeNodeKind === 'folder' ? 'story_entity_folder' : 'story_entity',
        activeRawId,
        activeNodeKind === 'folder'
          ? { parent_id: effectiveFolderId, display_order: mixedNewIndex }
          : { folder_id: effectiveFolderId, display_order: mixedNewIndex },
        'Failed to reorder item.',
      );
    } catch {
      // handled in performStructureMove
    }
  }, [effectiveFolderId, gridItems, parentInfo, performStructureMove, projectId]);

  const currentExpandedEntity = expandedEntityId
    ? entities.find((entity) => entity.id === expandedEntityId) ?? null
    : null;
  const currentExpandedEntityLanguageState = currentExpandedEntity
    ? getEntityLanguageState(currentExpandedEntity, settings.mainLanguage)
    : null;

  // Get the selected folder name for the header
  const selectedFolderName = useMemo(() => {
    if (effectiveFolderId && foldersById[effectiveFolderId]) {
      return getStoryEntityFolderName(foldersById[effectiveFolderId], globalDisplayLanguage, settings.mainLanguage);
    }
    return 'Root';
  }, [effectiveFolderId, foldersById, globalDisplayLanguage, settings.mainLanguage]);

  const selectedFolderDescription = useMemo(() => {
    if (effectiveFolderId && foldersById[effectiveFolderId]) {
      return getStoryEntityFolderDescription(
        foldersById[effectiveFolderId],
        globalDisplayLanguage,
        settings.mainLanguage,
      );
    }
    return '';
  }, [effectiveFolderId, foldersById, globalDisplayLanguage, settings.mainLanguage]);
  const hasSelectedFolderDescription = selectedFolderDescription.trim().length > 0;

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
      <div className="story-entity-manager__main">
        <div className="story-entity-manager__top">
          <div className="section-header story-entity-manager__header">
            <div className={`story-entity-manager__heading${hasSelectedFolderDescription ? '' : ' story-entity-manager__heading--title-only'}`}>
              <h2>{selectedFolderName}</h2>
              {hasSelectedFolderDescription ? (
                <p className="story-entity-manager__description">{selectedFolderDescription}</p>
              ) : null}
            </div>

            <div className="header-buttons story-entity-manager__actions">
              {currentEntityIds.length > 0 ? (
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

              {isMainLanguageView ? (
                <DropdownMenu
                  trigger={(
                    <TextButton
                      variant="secondary"
                      size="sm"
                      iconLeft={<Plus size="xs" />}
                    >
                      Add
                    </TextButton>
                  )}
                >
                  <DropdownItem
                    icon={<People size="sm" />}
                    label="Entity"
                    onClick={() => openCreateEntity()}
                  />
                  <DropdownItem
                    icon={<Folder size="sm" />}
                    label="Folder"
                    onClick={openCreateFolder}
                  />
                </DropdownMenu>
              ) : null}
            </div>
          </div>

          <div className="section-divider" />
        </div>

        <div className="story-entity-manager__body">
          <DndContext
            sensors={sensors}
            collisionDetection={folderAwareCollision}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            {onSelectFolder && parentInfo && (
              <DroppableParentBar
                parentName={parentInfo.parentName}
                onClick={() => onSelectFolder(parentInfo.parentId)}
              />
            )}

            {showSkeleton && !isCreatingFolder ? (
              <StoryEntityGridSkeleton />
            ) : gridItems.length === 0 && !isCreatingFolder ? (
              <div className="empty-state">
                <p>No items here.</p>
                <p>
                  {isMainLanguageView
                    ? 'Add a folder or story entity to get started.'
                    : `Create folders and entities in ${settings.mainLanguage}, then translate entities into ${globalDisplayLanguage}.`}
                </p>
              </div>
            ) : (
              <LayoutGroup id={`story-entities-${selectedFolderId ?? 'root'}`}>
                <SortableContext
                  items={gridItems.map((item) => item.sortId)}
                  strategy={rectSortingStrategy}
                >
                  <div
                    ref={gridRef}
                    className="object-cards-grid story-entity-cards-grid"
                    style={{ position: 'relative' }}
                  >
                    {isCreatingFolder ? (
                      <FolderInlineCard
                        name={newFolderName}
                        description={newFolderDescription}
                        submitLabel="Create"
                        onChange={setNewFolderName}
                        onDescriptionChange={setNewFolderDescription}
                        onSubmit={() => { void handleCreateFolder(); }}
                        onCancel={() => {
                          setIsCreatingFolder(false);
                          setNewFolderName('');
                          setNewFolderDescription('');
                        }}
                      />
                    ) : null}
                    {gridItems.map((item) => {
                      if (item.type === 'folder') {
                        const isEditingFolder = renamingFolderId === item.id;
                        return (
                          <SortableObjectCard
                            key={item.sortId}
                            id={item.sortId}
                            spanType="normal"
                            disabled={isEditingFolder}
                          >
                            {(dragHandle) => (
                              isEditingFolder ? (
                                <FolderInlineCard
                                  name={renameFolderValue}
                                  description={renameFolderDescription}
                                  submitLabel="Save"
                                  onChange={setRenameFolderValue}
                                  onDescriptionChange={setRenameFolderDescription}
                                  onSubmit={() => { void handleRenameFolder(item.id); }}
                                  onCancel={cancelRenameFolder}
                                />
                              ) : (
                                <FolderGridCard
                                  folderId={item.id}
                                  name={item.name}
                                  description={item.description}
                                  dragHandle={dragHandle}
                                  isEditable={isMainLanguageView}
                                  onClick={() => onSelectFolder?.(item.id)}
                                  onEdit={() => startRenameFolder(item.folder)}
                                  onDelete={() => { void handleDeleteFolder(item.folder); }}
                                />
                              )
                            )}
                          </SortableObjectCard>
                        );
                      }

                      const mainAsset = mainAssetsByEntityId[item.entity.id] ?? null;
                      const baseSpanType = getSpanType(mainAsset);
                      const spanType = (baseSpanType === 'horizontal' && columnCount < 2) ? 'normal' : baseSpanType;

                      return (
                        <SortableObjectCard key={item.sortId} id={item.sortId} spanType={spanType} disabled={expandedEntityId === item.entity.id}>
                          {(dragHandle) => (
                            <EntityCard
                              entity={item.entity}
                              itemData={item.itemData}
                              description={item.description}
                              contentMarkdown={markdownContentByEntityId[item.entity.id]}
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
                        </SortableObjectCard>
                      );
                    })}
                  </div>
                </SortableContext>
              </LayoutGroup>
            )}

            <DragOverlay dropAnimation={null}>
              {activeDragId && (
                <DragOverlayContent
                  activeDragId={activeDragId}
                  gridItems={gridItems}
                  mainAssetsByEntityId={mainAssetsByEntityId}
                />
              )}
            </DragOverlay>
          </DndContext>

      <AnimatePresence mode="sync">
        {currentExpandedEntity && editingEntityDraft ? (
          <motion.div
            key={`entity-overlay-${currentExpandedEntity.id}`}
            className="story-entity-card-expanded-container"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.15 } }}
            transition={{ duration: 0.2 }}
          >
            <ObjectCardExpanded
              itemId={currentExpandedEntity.id}
              itemData={getEntityData(currentExpandedEntity, currentExpandedEntityLanguageState?.viewLanguage ?? settings.mainLanguage)}
              effectiveLanguage={currentExpandedEntityLanguageState?.viewLanguage ?? settings.mainLanguage}
              versionNumber={currentExpandedEntity.version.number}
              objectType="story_entity"
              mainAsset={getMainAssetFromLinks(objectAssetsByKey[`${projectId}:story_entity:${currentExpandedEntity.id}`])}
              loading={updateObjectMutation.isPending}
              readOnly={!currentExpandedEntityLanguageState?.canEdit}
              readOnlyReason={
                currentExpandedEntityLanguageState && !currentExpandedEntityLanguageState.canEdit
                  ? `This ${KIND_SHORT_LABELS[currentExpandedEntity.kind ?? 'character'].toLowerCase()} is only available in ${currentExpandedEntityLanguageState.viewLanguage}. Translate it into ${currentExpandedEntityLanguageState.requestedLanguage} to edit.`
                  : undefined
              }
              primaryActionLabel={!currentExpandedEntityLanguageState?.canEdit ? 'Translate' : undefined}
              onPrimaryAction={!currentExpandedEntityLanguageState?.canEdit
                ? () => openTranslationModalForTarget(currentExpandedEntity.id)
                : undefined}
              hideAIEdit={!currentExpandedEntityLanguageState?.isMainLanguage}
              saveLabel={currentExpandedEntityLanguageState?.isTranslationView ? 'Save Translation' : 'Save'}
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
                      disabled={!currentExpandedEntityLanguageState?.canEdit}
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
                      options={folderOptions}
                      disabled={!currentExpandedEntityLanguageState?.canEdit}
                    />
                  </div>
                </div>
              )}
              onSave={handleSaveEntity}
              onCancel={closeEntityEditor}
              onAIEdit={currentExpandedEntityLanguageState?.isMainLanguage ? () => {
                setAIEditTargetId(currentExpandedEntity.id);
                setShowAIModal(true);
              } : undefined}
              onVersionHistory={() => {
                setVersionHistoryTargetId(currentExpandedEntity.id);
                setShowVersionHistory(true);
              }}
              onRetranslate={currentExpandedEntityLanguageState?.isTranslationView ? () => {
                openTranslationModalForTarget(currentExpandedEntity.id);
              } : undefined}
              onDelete={() => {
                void handleDeleteEntity(currentExpandedEntity.id);
              }}
              onAssetChange={() => {
                void fetchObjectAssetLinks(projectId, 'story_entity', currentExpandedEntity.id, true);
              }}
            />
          </motion.div>
        ) : null}

        {newEntityDraft ? (
          <motion.div
            key={`new-entity-overlay-${newEntityDraft.kind}`}
            className="story-entity-card-expanded-container"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.15 } }}
            transition={{ duration: 0.2 }}
          >
            <ObjectCardExpanded
              itemId="new-story-entity"
              itemData={{ name: '', description: '', content: emptyDoc() }}
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
                      onChange={(event) => setNewEntityDraft((prev) => prev ? {
                        ...prev,
                        kind: event as StoryEntityKind,
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
                      options={folderOptions}
                    />
                  </div>
                </div>
              )}
              onSave={handleCreateEntity}
              onCancel={() => setNewEntityDraft(null)}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

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

      {translationTargetId ? (
        <TranslationModal
          isOpen={showTranslationModal}
          onClose={() => {
            setShowTranslationModal(false);
            setTranslationTargetId(undefined);
          }}
          projectId={projectId}
          preSelectedObjectIds={[translationTargetId]}
          defaultSourceLanguage={resolveTranslationSourceLanguage(
            translationTargetId
              ? entities.find((entity) => entity.id === translationTargetId)?.language_state.available_languages ?? []
              : [],
            settings.mainLanguage,
          )}
          defaultTargetLanguage={globalDisplayLanguage}
        />
      ) : null}
        </div>{/* end story-entity-manager__body */}
      </div>{/* end story-entity-manager__main */}

      {/* Desktop folder tree panel - hidden on mobile */}
      {onSelectFolder && projectId && (
        <div className="story-entity-manager__tree-panel">
          <FolderTreeContent
            projectId={projectId}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            displayLanguage={globalDisplayLanguage}
          />
        </div>
      )}
    </div>
  );
};

const EntityCard: React.FC<{
  entity: StoryEntityObject;
  itemData: StoryEntityData;
  description: string;
  contentMarkdown?: string;
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
  contentMarkdown,
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
    <ObjectCard
      name={itemData.name}
      description={description}
      contentMarkdown={contentMarkdown}
      imageUrl={imageUrl}
      expanded={isExpanded}
      spanType={spanType}
      className="story-entity-card"
      badge={(
        <span
          className="story-entity-card-kind-badge"
          title={KIND_SHORT_LABELS[entity.kind ?? 'character']}
          aria-label={KIND_SHORT_LABELS[entity.kind ?? 'character']}
        >
          {kindIcon(entity.kind ?? 'character')}
        </span>
      )}
      enableFitText
      dragHandle={dragHandle}
      layoutId={`card-${entity.id}`}
      isFullExpanded={isFullExpanded}
      isAnimating={isAnimating}
      onToggleExpand={onToggleExpand}
      onOpenFullExpand={onOpenFullExpand}
      onAnimationComplete={onAnimationComplete}
    />
  </div>
);

const FolderGridCard: React.FC<{
  folderId: string;
  name: string;
  description: string;
  dragHandle: React.ReactNode;
  isEditable: boolean;
  onClick: () => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ folderId, name, description, dragHandle, isEditable, onClick, onEdit, onDelete }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-folder:${folderId}`,
  });

  return (
    <div
      ref={setNodeRef}
      className={`story-entity-grid-item story-entity-folder-card${isOver ? ' story-entity-folder-card--drag-over' : ''}`}
      data-span="normal"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
    >
      {isEditable ? (
        <div
          className="story-entity-folder-card__menu"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu
            trigger={(
              <IconButton
                icon={<MoreHorizontal size="xs" />}
                size="sm"
                variant="ghost"
                title="Folder actions"
                className="story-entity-folder-card__menu-button"
              />
            )}
          >
            <DropdownItem
              icon={<Edit size="sm" />}
              label="Edit"
              onClick={onEdit}
            />
            <DropdownItem
              icon={<Trash size="sm" />}
              label="Delete"
              variant="danger"
              onClick={onDelete}
            />
          </DropdownMenu>
        </div>
      ) : null}
      <div className="story-entity-folder-card__drag-slot">
        {dragHandle}
      </div>
      <span className="story-entity-folder-card__icon">
        <Folder size="2xl" />
      </span>
      <div className="story-entity-folder-card__text">
        <span className="story-entity-folder-card__name">{name}</span>
        {description ? (
          <span className="story-entity-folder-card__description">{description}</span>
        ) : null}
      </div>
    </div>
  );
};

const FolderInlineCard: React.FC<{
  name: string;
  description: string;
  submitLabel: string;
  onChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}> = ({ name, description, submitLabel, onChange, onDescriptionChange, onSubmit, onCancel }) => (
  <div className="story-entity-grid-item" data-span="normal">
    <div className="story-entity-folder-card story-entity-folder-draft-card">
      <span className="story-entity-folder-card__icon">
        <Folder size="2xl" />
      </span>
      <input
        className="story-entity-folder-draft-card__input"
        type="text"
        value={name}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onSubmit();
          }
          if (event.key === 'Escape') {
            onCancel();
          }
        }}
        placeholder="Folder name"
        autoFocus
      />
      <textarea
        className="story-entity-folder-draft-card__textarea"
        value={description}
        onChange={(event) => onDescriptionChange(event.target.value)}
        placeholder="Folder description"
        rows={3}
      />
      <div className="story-entity-folder-draft-card__actions">
        <TextButton variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </TextButton>
        <TextButton variant="secondary" size="sm" onClick={onSubmit} disabled={!name.trim()}>
          {submitLabel}
        </TextButton>
      </div>
    </div>
  </div>
);

const DroppableParentBar: React.FC<{
  parentName: string;
  onClick: () => void;
}> = ({ parentName, onClick }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: 'drop-parent-folder',
  });

  return (
    <button
      ref={setNodeRef}
      className={`story-entity-parent-bar${isOver ? ' story-entity-parent-bar--drag-over' : ''}`}
      onClick={onClick}
      type="button"
    >
      <ChevronRight size="xs" />
      <span>{parentName}</span>
    </button>
  );
};

const DragOverlayContent: React.FC<{
  activeDragId: string;
  gridItems: GridItem[];
  mainAssetsByEntityId: Record<string, ReturnType<typeof getMainAssetFromLinks>>;
}> = ({ activeDragId, gridItems, mainAssetsByEntityId }) => {
  const item = gridItems.find((gi) => gi.sortId === activeDragId);
  if (!item) return null;

  if (item.type === 'folder') {
    return (
      <div className="story-entity-folder-card story-entity-drag-overlay">
        <span className="story-entity-folder-card__icon">
          <Folder size="2xl" />
        </span>
        <span className="story-entity-folder-card__name">{item.name}</span>
      </div>
    );
  }

  const mainAsset = mainAssetsByEntityId[item.entity.id] ?? null;
  return (
    <div className="story-entity-drag-overlay">
      <ObjectCard
        name={item.label}
        description={item.description}
        imageUrl={mainAsset ? getAssetUrl(mainAsset) : null}
        spanType="normal"
        className="story-entity-card"
        badge={(
          <span
            className="story-entity-card-kind-badge"
            title={KIND_SHORT_LABELS[item.entity.kind ?? 'character']}
            aria-label={KIND_SHORT_LABELS[item.entity.kind ?? 'character']}
          >
            {kindIcon(item.entity.kind ?? 'character')}
          </span>
        )}
      />
    </div>
  );
};

export default StoryEntityExplorer;

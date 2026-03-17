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
import { SortableObjectCard } from '../ObjectManager/ObjectCards/SortableObjectCard';
import { ObjectCard } from '../ObjectManager/ObjectCards/ObjectCard';
import ObjectCardExpanded from '../ObjectManager/ObjectCards/ObjectCardExpanded';
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
import {
  getStoryEntityFolderData,
  getStoryEntityFolderDescription,
  getStoryEntityFolderName,
  type StoryEntityFolder,
} from '../../types/storyEntityFolder';
import type { StoryEntityData, StoryEntityKind, StoryEntityObject } from '../../types/unifiedObject';
import type { ObjectAssetLink } from '../../api/assetService';
import {
  resolveRequestedLanguageState,
  resolveTranslationSourceLanguage,
  type RequestedLanguageState,
} from '../../utils/requestedLanguage';
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
  description: string;
  parentId: string | null;
  requestedLanguage: string;
  createNewVersion: boolean;
  saveLabel: string;
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
    previewDescription: string;
    previewLabels: string[];
  }
  | {
    kind: 'entity';
    id: string;
    order: number;
    label: string;
    entity: StoryEntityObject;
    itemData: StoryEntityData;
    languageState: RequestedLanguageState;
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
    return a.id.localeCompare(b.id);
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

function getEntityLanguageState(
  entity: StoryEntityObject,
  requestedLanguage: string,
  mainLanguage: string,
): RequestedLanguageState {
  return resolveRequestedLanguageState({
    availableLanguages: Object.keys(entity.data),
    requestedLanguage,
    mainLanguage,
  });
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

function getFolderLanguageState(
  folder: StoryEntityFolder,
  requestedLanguage: string,
  mainLanguage: string,
): RequestedLanguageState {
  return resolveRequestedLanguageState({
    availableLanguages: Object.keys(folder.data),
    requestedLanguage,
    mainLanguage,
  });
}

function getSortableId(item: MixedGridItem): string {
  return `${item.kind}:${item.id}`;
}

function getMainAssetFromLinks(links: ObjectAssetLink[] | undefined) {
  return links?.find((entry) => entry.is_main)?.asset ?? null;
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
  const updateFolder = useStoryEntityFolderStore((state) => state.updateFolder);
  const moveFolder = useStoryEntityFolderStore((state) => state.moveFolder);
  const moveTreeNode = useStoryEntityFolderStore((state) => state.moveTreeNode);
  const deleteFolder = useStoryEntityFolderStore((state) => state.deleteFolder);

  const fetchObjectAssetLinks = useAssetStore((state) => state.fetchObjectAssetLinks);
  const objectAssetsByKey = useAssetStore((state) => state.objectAssetsByKey);

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
  const [showTranslationModal, setShowTranslationModal] = useState(false);
  const [translationTargetId, setTranslationTargetId] = useState<string | undefined>(undefined);

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

  const isMainLanguageView = globalDisplayLanguage === settings.mainLanguage;

  const openTranslationModalForTarget = useCallback((targetId: string) => {
    setTranslationTargetId(targetId);
    setShowTranslationModal(true);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    void Promise.all([
      listObjects('story_entity', projectId),
      fetchFolders(projectId, globalDisplayLanguage || settings.mainLanguage),
    ]).catch((error) => {
      console.error('Failed to load story entities:', error);
      showAlert({ title: 'Load Error', message: 'Failed to load story entities.' });
    });
  }, [projectId, listObjects, fetchFolders, globalDisplayLanguage, settings.mainLanguage]);

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

  const mainAssetsByEntityId = useMemo(() => {
    if (!projectId) return {};
    return currentFolderEntities.reduce<Record<string, ReturnType<typeof getMainAssetFromLinks>>>((acc, entity) => {
      acc[entity.id] = getMainAssetFromLinks(objectAssetsByKey[`${projectId}:story_entity:${entity.id}`]);
      return acc;
    }, {});
  }, [currentFolderEntities, projectId, objectAssetsByKey]);

  useEffect(() => {
    if (!projectId || currentFolderEntities.length === 0) return;
    currentFolderEntities.forEach((entity) => {
      void fetchObjectAssetLinks(projectId, 'story_entity', entity.id);
    });
  }, [projectId, currentFolderEntities, fetchObjectAssetLinks]);

  const breadcrumbs = useMemo(() => folderPath(currentFolderId, foldersById), [currentFolderId, foldersById]);
  const currentFolder = currentFolderId ? foldersById[currentFolderId] ?? null : null;
  const currentFolderLanguageState = currentFolder
    ? getFolderLanguageState(currentFolder, globalDisplayLanguage, settings.mainLanguage)
    : null;

  const folderOptions = useMemo(
    () => [
      { id: null as string | null, label: 'Root' },
      ...folders.map((folder) => ({
        id: folder.id,
        label: folderPath(folder.id, foldersById)
          .map((entry) => getStoryEntityFolderName(entry, globalDisplayLanguage, settings.mainLanguage))
          .join(' / '),
      })),
    ],
    [folders, foldersById, globalDisplayLanguage, settings.mainLanguage],
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
      const folderName = getStoryEntityFolderName(folder, globalDisplayLanguage, settings.mainLanguage);
      const folderDescription = getStoryEntityFolderDescription(folder, globalDisplayLanguage, settings.mainLanguage);
      const previewLabels = [
        ...nestedFolders.map((item) => getStoryEntityFolderName(item, globalDisplayLanguage, settings.mainLanguage)),
        ...nestedEntities.map((entity) => {
          const languageState = getEntityLanguageState(entity, globalDisplayLanguage, settings.mainLanguage);
          return getEntityData(entity, languageState.viewLanguage).name || 'Untitled Entity';
        }),
      ].slice(0, 4);

      return {
        kind: 'folder',
        id: folder.id,
        order: folder.display_order,
        label: folderName,
        folder,
        childFolderCount: nestedFolders.length,
        childEntityCount: nestedEntities.length,
        previewLabels,
        previewDescription: folderDescription,
      };
    });

    const entityItems = childEntities.map<MixedGridItem>((entity) => {
      const languageState = getEntityLanguageState(entity, globalDisplayLanguage, settings.mainLanguage);
      const itemData = getEntityData(entity, languageState.viewLanguage);
      return {
        kind: 'entity',
        id: entity.id,
        order: entity.metadata.display_order ?? 0,
        label: itemData.name || 'Untitled Entity',
        entity,
        itemData,
        languageState,
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
    if (!isMainLanguageView) return;
    setExpandedEntityId(null);
    setEditingEntityDraft(null);
    setNewEntityDraft({ kind, folderId: currentFolderId });
  }, [currentFolderId, isMainLanguageView]);

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
    const entity = entities.find((item) => item.id === expandedEntityId);
    if (!entity) return;
    const languageState = getEntityLanguageState(entity, globalDisplayLanguage, settings.mainLanguage);
    if (!languageState.canEdit) return;
    try {
      await updateObject('story_entity', expandedEntityId, {
        kind: editingEntityDraft.kind,
        data: {
          name: name.trim(),
          description: description.trim(),
          content: content.trim(),
        },
        language: languageState.requestedLanguage,
        user_request: 'User Edit',
        create_new_version: languageState.createNewVersion,
        metadata: {
          folder_id: editingEntityDraft.folderId,
        },
      });
      closeEntityEditor();
    } catch (error) {
      console.error('Failed to save story entity:', error);
      showAlert({ title: 'Save Error', message: 'Failed to save story entity.' });
    }
  }, [closeEntityEditor, editingEntityDraft, entities, expandedEntityId, globalDisplayLanguage, settings.mainLanguage, updateObject]);

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
    if (!isMainLanguageView) return;
    setFolderDialog({
      mode: 'create',
      name: '',
      description: '',
      parentId: currentFolderId,
      requestedLanguage: settings.mainLanguage,
      createNewVersion: true,
      saveLabel: 'Save Folder',
    });
  }, [currentFolderId, isMainLanguageView, settings.mainLanguage]);

  const openEditFolderDialog = useCallback((folder: StoryEntityFolder) => {
    const languageState = getFolderLanguageState(folder, globalDisplayLanguage, settings.mainLanguage);
    if (!languageState.canEdit) {
      openTranslationModalForTarget(folder.id);
      return;
    }
    const folderData = getStoryEntityFolderData(folder, languageState.viewLanguage, settings.mainLanguage);
    setFolderDialog({
      mode: 'edit',
      folderId: folder.id,
      name: folderData.name,
      description: folderData.description,
      parentId: folder.parent_id ?? null,
      requestedLanguage: languageState.requestedLanguage,
      createNewVersion: languageState.createNewVersion,
      saveLabel: languageState.isTranslationView ? 'Save Folder Translation' : 'Save Folder',
    });
  }, [globalDisplayLanguage, openTranslationModalForTarget, settings.mainLanguage]);

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
          language: folderDialog.requestedLanguage,
          name: folderDialog.name.trim(),
          description: folderDialog.description.trim(),
          parent_id: folderDialog.parentId,
        });
      } else if (folderDialog.folderId) {
        const folder = foldersById[folderDialog.folderId];
        if (!folder) return;
        const currentFolderData = getStoryEntityFolderData(folder, folderDialog.requestedLanguage, settings.mainLanguage);
        if (
          currentFolderData.name !== folderDialog.name.trim()
          || currentFolderData.description !== folderDialog.description.trim()
        ) {
          await updateFolder(projectId, folderDialog.folderId, {
            language: folderDialog.requestedLanguage,
            name: folderDialog.name.trim(),
            description: folderDialog.description.trim(),
            create_new_version: folderDialog.createNewVersion,
          });
        }
        if ((folder.parent_id ?? null) !== (folderDialog.parentId ?? null)) {
          await moveFolder(projectId, folderDialog.folderId, { new_parent_id: folderDialog.parentId });
        }
      }
      setFolderDialog(null);
    } catch (error) {
      console.error('Failed to save folder:', error);
      showAlert({ title: 'Save Error', message: 'Failed to save folder.' });
    } finally {
      setIsSavingFolder(false);
    }
  }, [createFolder, folderDialog, foldersById, moveFolder, projectId, settings.mainLanguage, updateFolder]);

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
  const currentExpandedEntityLanguageState = currentExpandedEntity
    ? getEntityLanguageState(currentExpandedEntity, globalDisplayLanguage, settings.mainLanguage)
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
          <h2>{currentFolder ? getStoryEntityFolderName(currentFolder, globalDisplayLanguage, settings.mainLanguage) : 'Story Entities'}</h2>
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
                {getStoryEntityFolderName(folder, globalDisplayLanguage, settings.mainLanguage)}
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
              {currentFolderLanguageState?.canEdit ? 'Edit Folder' : 'Translate Folder'}
            </TextButton>
          ) : null}

          {isMainLanguageView ? (
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
          ) : null}
        </div>
      </div>

      <div className="section-divider" />

      {currentItems.length === 0 ? (
        <div className="empty-state">
          <p>No folders or entities here.</p>
          <p>
            {isMainLanguageView
              ? 'Create a folder or add a new story entity in this location.'
              : `Create new folders and entities in ${settings.mainLanguage}, then translate them into ${globalDisplayLanguage}.`}
          </p>
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
                className="object-cards-grid story-entity-cards-grid"
                style={{ position: 'relative' }}
              >
                {currentItems.map((item) => {
                  if (item.kind === 'folder') {
                    return (
                      <SortableObjectCard key={getSortableId(item)} id={getSortableId(item)} spanType="normal">
                        {(dragHandle) => (
                          <FolderCard
                            name={item.label}
                            description={item.previewDescription}
                            childFolderCount={item.childFolderCount}
                            childEntityCount={item.childEntityCount}
                          previewLabels={item.previewLabels}
                          dragHandle={dragHandle}
                          onOpen={() => setCurrentFolderId(item.folder.id)}
                          onEdit={() => openEditFolderDialog(item.folder)}
                          editLabel={
                            getFolderLanguageState(item.folder, globalDisplayLanguage, settings.mainLanguage).canEdit
                              ? 'Edit'
                              : 'Translate Folder'
                          }
                        />
                      )}
                    </SortableObjectCard>
                    );
                  }

                  const mainAsset = mainAssetsByEntityId[item.entity.id] ?? null;
                  const baseSpanType = getSpanType(mainAsset);
                  const spanType = (baseSpanType === 'horizontal' && columnCount < 2) ? 'normal' : baseSpanType;

                  return (
                    <SortableObjectCard key={getSortableId(item)} id={getSortableId(item)} spanType={spanType} disabled={expandedEntityId === item.entity.id}>
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
                    </SortableObjectCard>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>

          <AnimatePresence mode="sync">
            {currentExpandedEntity && editingEntityDraft ? (
              <motion.div
                key={`entity-overlay-${currentExpandedEntity.id}`}
                className="object-card-expanded-container"
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
                  loading={loading[currentExpandedEntity.id] || false}
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
                          options={storyEntityFolderSelectOptions}
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
                className="object-card-expanded-container"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.4, delay: 0.15 } }}
                transition={{ duration: 0.2 }}
              >
                <ObjectCardExpanded
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
                className="object-card-expanded-container"
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
                      <span>Description</span>
                      <textarea
                        value={folderDialog.description}
                        onChange={(event) => setFolderDialog((prev) => prev ? {
                          ...prev,
                          description: event.target.value,
                        } : prev)}
                        placeholder="Folder description"
                        rows={4}
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
                      {folderDialog.saveLabel}
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
              ? (foldersById[translationTargetId]
                ? Object.keys(foldersById[translationTargetId].data)
                : Object.keys(entities.find((entity) => entity.id === translationTargetId)?.data ?? {}))
              : [],
            settings.mainLanguage,
          )}
          defaultTargetLanguage={globalDisplayLanguage}
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
    <ObjectCard
      name={itemData.name}
      description={description}
      content={itemData.content}
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

const FolderCard: React.FC<{
  name: string;
  description: string;
  childFolderCount: number;
  childEntityCount: number;
  previewLabels: string[];
  dragHandle: React.ReactNode;
  onOpen: () => void;
  onEdit: () => void;
  editLabel?: string;
}> = ({
  name,
  description,
  childFolderCount,
  childEntityCount,
  previewLabels,
  dragHandle,
  onOpen,
  onEdit,
  editLabel = 'Edit',
}) => (
  <div className="story-entity-grid-item" data-span="normal">
    <article className="object-card story-entity-folder-card" data-has-image="false" data-span="normal">
      <span
        className="story-entity-card-kind-badge story-entity-card-kind-badge--folder"
        title="Folder"
        aria-label="Folder"
      >
        <Folder size="sm" />
      </span>

      <div className="object-card__content">
        <div className="object-card__drag-slot">
          {dragHandle}
        </div>
        <div className="object-card__body-shell">
          <header className="object-card__header">
            <h4
              className="object-card__title object-card__title--no-toggle"
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
              {name}
            </h4>
            <p className="object-card__subtitle">
              {childFolderCount} folders · {childEntityCount} entities
            </p>
          </header>

          <div className="object-card__description-wrapper story-entity-folder-card__description-wrapper">
            <div className="object-card__description">
              {description ? (
                <p>{description}</p>
              ) : previewLabels.length > 0 ? (
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
              {editLabel}
            </TextButton>
          </div>
        </div>
      </div>
    </article>
  </div>
);

export default StoryEntityExplorer;

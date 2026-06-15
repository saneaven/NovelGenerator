import React, { useEffect, useMemo, useState } from 'react';
import { useUnifiedObjectStore, useObjectCollectionStatus } from '../../store/unifiedObjectStore';
import { useSettings } from '../../store/settingsStore';
import { SkeletonList } from '../common/Skeleton';
import { ChevronRight, Folder } from '../icons';
import { getStoryEntityFolderName, type StoryEntityFolder } from '../../types/storyEntityFolder';
import {
  buildEntityCountByFolder,
  buildFolderChildrenMap,
  getProjectStoryEntities,
  getProjectStoryEntityFolders,
} from '../../utils/storyEntityTree';
import './FolderTreeContent.css';

interface FolderTreeContentProps {
  projectId: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  displayLanguage: string;
}

const FolderTreeContent: React.FC<FolderTreeContentProps> = ({
  projectId,
  selectedFolderId,
  onSelectFolder,
  displayLanguage,
}) => {
  const settings = useSettings();
  const mainLanguage = settings.mainLanguage;
  const objects = useUnifiedObjectStore((state) => state.objects);
  const { loading: treeLoading, hydrated: treeHydrated } = useObjectCollectionStatus(
    projectId,
    ['story_entity_folder'],
    displayLanguage,
  );
  const showSkeleton = treeLoading && !treeHydrated;
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const folders = useMemo(
    () => getProjectStoryEntityFolders(objects, projectId),
    [objects, projectId],
  );

  const foldersById = useMemo(
    () => folders.reduce<Record<string, StoryEntityFolder>>((acc, folder) => {
      acc[folder.id] = folder;
      return acc;
    }, {}),
    [folders],
  );

  const entities = useMemo(
    () => getProjectStoryEntities(objects, projectId),
    [objects, projectId],
  );

  const entityCountByFolder = useMemo(
    () => buildEntityCountByFolder(entities),
    [entities],
  );

  const folderChildren = useMemo(
    () => buildFolderChildrenMap(folders, displayLanguage, mainLanguage),
    [displayLanguage, folders, mainLanguage],
  );

  const rootFolders = useMemo(() => folderChildren.get(null) ?? [], [folderChildren]);
  const rootEntityCount = entityCountByFolder.get(null) ?? 0;

  useEffect(() => {
    if (!selectedFolderId) return;
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      let currentId = selectedFolderId;
      while (currentId) {
        const parentId = foldersById[currentId]?.metadata.parent_id ?? null;
        if (!parentId) break;
        next.add(parentId);
        currentId = parentId;
      }
      return next;
    });
  }, [foldersById, selectedFolderId]);

  const toggleNode = (folderId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const renderFolderNode = (folder: StoryEntityFolder, depth: number) => {
    const children = folderChildren.get(folder.id) ?? [];
    const entityCount = entityCountByFolder.get(folder.id) ?? 0;
    const hasChildren = children.length > 0;
    const isExpanded = expandedNodes.has(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const name = getStoryEntityFolderName(folder, displayLanguage, mainLanguage);

    return (
      <div key={folder.id}>
        <div
          className={`folder-tree-node ${isSelected ? 'folder-tree-node--selected' : ''}`}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
        >
          <button
            className={`folder-tree-node__toggle ${hasChildren ? '' : 'folder-tree-node__toggle--hidden'} ${isExpanded ? 'folder-tree-node__toggle--open' : ''}`}
            onClick={() => hasChildren && toggleNode(folder.id)}
            tabIndex={hasChildren ? 0 : -1}
            type="button"
          >
            <ChevronRight size="xs" />
          </button>

          <span className="folder-tree-node__icon">
            <Folder size="sm" />
          </span>

          <button
            className="folder-tree-node__name"
            onClick={() => onSelectFolder(folder.id)}
            type="button"
          >
            {name}
          </button>

          {entityCount > 0 ? (
            <span className="folder-tree-node__count">{entityCount}</span>
          ) : null}
        </div>

        {isExpanded ? children.map((child) => renderFolderNode(child, depth + 1)) : null}
      </div>
    );
  };

  return (
    <div className="folder-tree-content">
      <div
        className={`folder-tree-node folder-tree-node--special ${selectedFolderId === null ? 'folder-tree-node--selected' : ''}`}
        style={{ paddingLeft: '12px' }}
      >
        <span className="folder-tree-node__toggle folder-tree-node__toggle--hidden">
          <ChevronRight size="xs" />
        </span>
        <button
          className="folder-tree-node__name"
          onClick={() => onSelectFolder(null)}
          type="button"
        >
          Root
        </button>
        {rootEntityCount > 0 ? <span className="folder-tree-node__count">{rootEntityCount}</span> : null}
      </div>

      {showSkeleton ? (
        <>
          <div className="folder-tree-content__divider" />
          <div style={{ padding: '0 12px' }}>
            <SkeletonList rows={4} rowHeight={28} />
          </div>
        </>
      ) : (
        <>
          {rootFolders.length > 0 ? <div className="folder-tree-content__divider" /> : null}
          {rootFolders.map((folder) => renderFolderNode(folder, 0))}
        </>
      )}
    </div>
  );
};

export default FolderTreeContent;

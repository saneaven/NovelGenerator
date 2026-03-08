import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { fragmentService } from '../../../api/fragmentService';
import { folderService } from '../../../api/folderService';
import type { FragmentTreeResponse, FragmentListItem, FolderTreeNode } from '../../../types/fragments';
import { ChevronRight, Plus, Folder, Close, GripVertical, Trash } from '../../icons';
import { TextButton } from '../../TextButton';
import { confirm, alert as showAlert } from '../../../store/dialogStore';
import './FragmentTreeNav.css';

interface DraggedFragment {
  folderId: string | null;
  fragmentName: string;
}

interface FragmentTreeNavProps {
  selectedPath: string | null;
  onFragmentSelect: (folderId: string | null, fragmentName: string, fullPath: string) => void;
  onCreateFragment: (folderPath: string | null) => void;
  onFolderDeleted: (folderPath: string) => void;
  refreshTrigger?: number;
  onClose?: () => void;
}

interface FolderNodeProps {
  node: FolderTreeNode;
  level: number;
  selectedPath: string | null;
  expandedNodes: Set<string>;
  onFragmentSelect: (folderId: string | null, fragmentName: string, fullPath: string) => void;
  onToggleExpand: (id: string) => void;
  onCreateFragment: (folderPath: string | null) => void;
  onDeleteFolder: (node: FolderTreeNode) => void;
  onDragStart: (e: React.DragEvent, fragment: FragmentListItem) => void;
  onFolderDragOver: (e: React.DragEvent) => void;
  onFolderDrop: (e: React.DragEvent, targetFolderId: string) => void;
  deletingFolderId: string | null;
}

const FragmentItem: React.FC<{
  fragment: FragmentListItem;
  level: number;
  isSelected: boolean;
  onSelect: () => void;
  onDragStart: (e: React.DragEvent, fragment: FragmentListItem) => void;
}> = ({ fragment, level, isSelected, onSelect, onDragStart }) => {
  return (
    <div
      className={`tree-node__content tree-node__content--fragment ${isSelected ? 'tree-node__content--selected' : ''}`}
      style={{ paddingLeft: `${level * 16 + 24}px` }}
      onClick={onSelect}
      draggable
      onDragStart={(e) => onDragStart(e, fragment)}
    >
      <span className="tree-node__grip">
        <GripVertical size="xs" />
      </span>
      <span className="tree-node__label">{fragment.fragment_name}</span>
    </div>
  );
};

const FolderNode: React.FC<FolderNodeProps> = ({
  node,
  level,
  selectedPath,
  expandedNodes,
  onFragmentSelect,
  onToggleExpand,
  onCreateFragment,
  onDeleteFolder,
  onDragStart,
  onFolderDragOver,
  onFolderDrop,
  deletingFolderId,
}) => {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const isExpanded = expandedNodes.has(node.id);
  const hasChildren = (node.children && node.children.length > 0) || (node.fragments && node.fragments.length > 0);
  const isDeleting = deletingFolderId === node.id;

  const handleClick = () => {
    onToggleExpand(node.id);
  };

  const handleAddClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onCreateFragment(node.path);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDeleteFolder(node);
  };

  const handleDragOver = (e: React.DragEvent) => {
    onFolderDragOver(e);
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    setIsDragOver(false);
    onFolderDrop(e, node.id);
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-node__content tree-node__content--folder ${isDragOver ? 'tree-node__content--drag-over' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className={`tree-node__expand-icon ${isExpanded ? 'tree-node__expand-icon--expanded' : ''}`}>
          {hasChildren ? <ChevronRight size="xs" /> : <span className="tree-node__expand-placeholder" />}
        </span>
        <span className="tree-node__icon"><Folder size="sm" /></span>
        <span className="tree-node__label">{node.name}</span>
        <span className="tree-node__actions">
          <button
            className="tree-node__action-btn"
            onClick={handleAddClick}
            title={t('settings.promptEditor.createNewFragment')}
            aria-label={t('settings.promptEditor.createNewFragment')}
          >
            <Plus size="xs" />
          </button>
          <button
            className="tree-node__action-btn tree-node__action-btn--danger"
            onClick={handleDeleteClick}
            title={t('settings.promptEditor.deleteFolder')}
            aria-label={t('settings.promptEditor.deleteFolder')}
            disabled={isDeleting}
          >
            <Trash size="xs" />
          </button>
        </span>
      </div>

      {hasChildren && (
        <div className={`tree-node__children ${isExpanded ? 'tree-node__children--expanded' : ''}`}>
          <div className="tree-node__children-inner">
            {node.children?.map((child) => (
              <FolderNode
                key={child.id}
                node={child}
                level={level + 1}
                selectedPath={selectedPath}
                expandedNodes={expandedNodes}
                onFragmentSelect={onFragmentSelect}
                onToggleExpand={onToggleExpand}
                onCreateFragment={onCreateFragment}
                onDeleteFolder={onDeleteFolder}
                onDragStart={onDragStart}
                onFolderDragOver={onFolderDragOver}
                onFolderDrop={onFolderDrop}
                deletingFolderId={deletingFolderId}
              />
            ))}

            {node.fragments?.map((fragment) => {
              const fragmentPath = fragment.folder_path
                ? `${fragment.folder_path}/${fragment.fragment_name}`
                : fragment.fragment_name;
              return (
                <FragmentItem
                  key={fragment.id}
                  fragment={fragment}
                  level={level + 1}
                  isSelected={selectedPath === fragmentPath}
                  onSelect={() => onFragmentSelect(fragment.folder_id, fragment.fragment_name, fragmentPath)}
                  onDragStart={onDragStart}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const FragmentTreeNav: React.FC<FragmentTreeNavProps> = ({
  selectedPath,
  onFragmentSelect,
  onCreateFragment,
  onFolderDeleted,
  refreshTrigger,
  onClose,
}) => {
  const { t } = useTranslation();
  const [treeData, setTreeData] = useState<FragmentTreeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [isRootDragOver, setIsRootDragOver] = useState(false);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const draggedRef = useRef<DraggedFragment | null>(null);

  useEffect(() => {
    loadTree();
  }, [refreshTrigger]);

  const loadTree = async () => {
    setIsLoading(true);
    try {
      const tree = await fragmentService.getFolderTree();
      setTreeData(tree);

      const allIds = new Set<string>();
      const collectIds = (folders: FolderTreeNode[]) => {
        folders.forEach(folder => {
          allIds.add(folder.id);
          if (folder.children) {
            collectIds(folder.children);
          }
        });
      };
      collectIds(tree.folders);
      setExpandedNodes(allIds);
    } catch (error) {
      console.error('Failed to load fragment tree:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleExpand = (id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, fragment: FragmentListItem) => {
    draggedRef.current = {
      folderId: fragment.folder_id,
      fragmentName: fragment.fragment_name,
    };
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFolderDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleFolderDrop = async (e: React.DragEvent, targetFolderId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const dragged = draggedRef.current;
    if (!dragged) return;
    draggedRef.current = null;

    if (dragged.folderId === targetFolderId) return;

    try {
      await fragmentService.moveFragment(dragged.folderId, dragged.fragmentName, targetFolderId);
      await loadTree();
    } catch (error) {
      console.error('Failed to move fragment:', error);
    }
  };

  const handleRootDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setIsRootDragOver(true);
  };

  const handleRootDragLeave = () => {
    setIsRootDragOver(false);
  };

  const handleRootDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsRootDragOver(false);
    const dragged = draggedRef.current;
    if (!dragged) return;
    draggedRef.current = null;

    if (dragged.folderId === null) return;

    try {
      await fragmentService.moveFragment(dragged.folderId, dragged.fragmentName, null);
      await loadTree();
    } catch (error) {
      console.error('Failed to move fragment to root:', error);
    }
  };

  const handleDeleteFolder = async (node: FolderTreeNode) => {
    const ok = await confirm({
      title: t('settings.promptEditor.deleteFolderConfirmTitle'),
      message: t('settings.promptEditor.deleteFolderConfirmMessage', { path: node.path }),
      detail: t('settings.promptEditor.deleteFolderConfirmDetail'),
      variant: 'danger',
      confirmLabel: t('common.delete'),
    });
    if (!ok) return;

    setDeletingFolderId(node.id);
    try {
      await folderService.deleteFolder(node.id);
      onFolderDeleted(node.path);
      await loadTree();
    } catch (error) {
      console.error('Failed to delete folder:', error);
      await showAlert({
        title: t('common.error'),
        message: t('settings.promptEditor.deleteFolderFailed'),
        detail: error instanceof Error ? error.message : null,
        variant: 'danger',
      });
    } finally {
      setDeletingFolderId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="tree-nav tree-nav--loading">
        <div className="loading-indicator">Loading...</div>
      </div>
    );
  }

  const hasFragments = treeData && (
    treeData.root_fragments.length > 0 || treeData.folders.length > 0
  );

  return (
    <nav className="tree-nav">
      <header className="tree-nav__header">
        <div className="tree-nav__header-left">
          <h3 className="tree-nav__title">{t('settings.promptEditor.fragments')}</h3>
        </div>
        {onClose && (
          <button
            className="tree-nav__close-btn"
            onClick={onClose}
            aria-label={t('settings.promptEditor.treeNav.closeSidebar')}
          >
            <Close size="sm" />
          </button>
        )}
      </header>

      <div
        className={`tree-nav__content ${isRootDragOver ? 'tree-nav__content--drag-over' : ''}`}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {!hasFragments ? (
          <div className="tree-nav__empty">
            <p>No fragments yet</p>
          </div>
        ) : (
          <>
            {treeData?.root_fragments.map((fragment) => {
              const fragmentPath = fragment.fragment_name;
              return (
                <FragmentItem
                  key={fragment.id}
                  fragment={fragment}
                  level={0}
                  isSelected={selectedPath === fragmentPath}
                  onSelect={() => onFragmentSelect(null, fragment.fragment_name, fragment.fragment_name)}
                  onDragStart={handleDragStart}
                />
              );
            })}

            {treeData?.folders.map((folder) => (
              <FolderNode
                key={folder.id}
                node={folder}
                level={0}
                selectedPath={selectedPath}
                expandedNodes={expandedNodes}
                onFragmentSelect={onFragmentSelect}
                onToggleExpand={handleToggleExpand}
                onCreateFragment={onCreateFragment}
                onDeleteFolder={handleDeleteFolder}
                onDragStart={handleDragStart}
                onFolderDragOver={handleFolderDragOver}
                onFolderDrop={handleFolderDrop}
                deletingFolderId={deletingFolderId}
              />
            ))}
          </>
        )}
      </div>

      <div className="tree-nav__footer">
        <TextButton iconLeft={<Plus size="sm" />} onClick={() => onCreateFragment(null)}>
          {t('settings.promptEditor.createNewFragment')}
        </TextButton>
      </div>
    </nav>
  );
};

export default FragmentTreeNav;

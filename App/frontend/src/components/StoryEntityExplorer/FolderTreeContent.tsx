import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useStoryEntityFolderStore } from '../../store/storyEntityFolderStore';
import { useUnifiedObjectStore } from '../../store/unifiedObjectStore';
import { useSettings } from '../../store/settingsStore';
import { confirm, alert as showAlert } from '../../store/dialogStore';
import { IconButton } from '../IconButton';
import { TextButton } from '../TextButton';
import { DropdownMenu, DropdownItem } from '../ui/DropdownMenu';
import {
  Plus,
  Trash,
  Edit,
  Folder,
  MoreHorizontal,
  ChevronRight,
} from '../icons';
import {
  getStoryEntityFolderName,
  type StoryEntityFolder,
} from '../../types/storyEntityFolder';
import type { StoryEntityObject } from '../../types/unifiedObject';
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
  const isMainLanguageView = displayLanguage === mainLanguage;

  const foldersById = useStoryEntityFolderStore((state) => state.foldersById);
  const createFolder = useStoryEntityFolderStore((state) => state.createFolder);
  const updateFolder = useStoryEntityFolderStore((state) => state.updateFolder);
  const deleteFolder = useStoryEntityFolderStore((state) => state.deleteFolder);
  const objects = useUnifiedObjectStore((state) => state.objects);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addFormParentId, setAddFormParentId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const folders = useMemo(
    () => Object.values(foldersById)
      .filter((f) => f.project_id === projectId)
      .sort((a, b) => a.display_order - b.display_order),
    [foldersById, projectId],
  );

  const entities = useMemo(
    () => Object.values(objects).filter(
      (o): o is StoryEntityObject => o.type === 'story_entity' && o.metadata.project_id === projectId,
    ),
    [objects, projectId],
  );

  const entityCountByFolder = useMemo(() => {
    const counts = new Map<string | null, number>();
    entities.forEach((e) => {
      const key = e.metadata.folder_id ?? null;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return counts;
  }, [entities]);

  const folderChildren = useMemo(() => {
    const map = new Map<string | null, StoryEntityFolder[]>();
    folders.forEach((f) => {
      const key = f.parent_id ?? null;
      const siblings = map.get(key) ?? [];
      siblings.push(f);
      map.set(key, siblings);
    });
    return map;
  }, [folders]);

  const rootFolders = useMemo(() => folderChildren.get(null) ?? [], [folderChildren]);
  const uncategorizedCount = entityCountByFolder.get(null) ?? 0;
  const totalEntityCount = entities.length;

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

  const handleCreateFolder = useCallback(async () => {
    if (!formName.trim()) return;
    try {
      await createFolder(projectId, {
        language: mainLanguage,
        name: formName.trim(),
        description: '',
        parent_id: addFormParentId,
      });
      setFormName('');
      setShowAddForm(false);
      setAddFormParentId(null);
    } catch {
      showAlert({ title: 'Create Error', message: 'Failed to create folder.' });
    }
  }, [addFormParentId, createFolder, formName, mainLanguage, projectId]);

  const handleRename = useCallback(async (folderId: string) => {
    if (!renameValue.trim()) {
      setRenamingFolderId(null);
      return;
    }
    try {
      await updateFolder(projectId, folderId, {
        language: mainLanguage,
        name: renameValue.trim(),
        description: '',
      });
    } catch {
      showAlert({ title: 'Rename Error', message: 'Failed to rename folder.' });
    }
    setRenamingFolderId(null);
  }, [mainLanguage, projectId, renameValue, updateFolder]);

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    const confirmed = await confirm({
      title: 'Delete Folder',
      message: 'Delete this folder, its descendant folders, and all nested story entities?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    try {
      await deleteFolder(projectId, folderId);
      if (selectedFolderId === folderId) {
        onSelectFolder(null);
      }
    } catch {
      showAlert({ title: 'Delete Error', message: 'Failed to delete folder.' });
    }
  }, [deleteFolder, onSelectFolder, projectId, selectedFolderId]);

  const startAddSubfolder = useCallback((parentId: string) => {
    setAddFormParentId(parentId);
    setFormName('');
    setShowAddForm(true);
    setExpandedNodes((prev) => new Set(prev).add(parentId));
  }, []);

  const startRename = useCallback((folder: StoryEntityFolder) => {
    setRenamingFolderId(folder.id);
    setRenameValue(getStoryEntityFolderName(folder, displayLanguage, mainLanguage));
  }, [displayLanguage, mainLanguage]);

  const renderFolderNode = (folder: StoryEntityFolder, depth: number) => {
    const children = folderChildren.get(folder.id) ?? [];
    const entityCount = entityCountByFolder.get(folder.id) ?? 0;
    const hasChildren = children.length > 0;
    const isExpanded = expandedNodes.has(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const isRenaming = renamingFolderId === folder.id;
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

          {isRenaming ? (
            <RenameInput
              value={renameValue}
              onChange={setRenameValue}
              onSubmit={() => handleRename(folder.id)}
              onCancel={() => setRenamingFolderId(null)}
            />
          ) : (
            <button
              className="folder-tree-node__name"
              onClick={() => onSelectFolder(folder.id)}
              onDoubleClick={() => isMainLanguageView && startRename(folder)}
              type="button"
            >
              {name}
            </button>
          )}

          {entityCount > 0 && (
            <span className="folder-tree-node__count">{entityCount}</span>
          )}

          {isMainLanguageView && (
            <div className="folder-tree-node__actions">
              <DropdownMenu
                trigger={
                  <IconButton
                    icon={<MoreHorizontal size="xs" />}
                    size="xs"
                    variant="ghost"
                  />
                }
              >
                <DropdownItem icon={<Plus size="sm" />} label="New Subfolder" onClick={() => startAddSubfolder(folder.id)} />
                <DropdownItem icon={<Edit size="sm" />} label="Rename" onClick={() => startRename(folder)} />
                <DropdownItem icon={<Trash size="sm" />} label="Delete" onClick={() => handleDeleteFolder(folder.id)} variant="danger" />
              </DropdownMenu>
            </div>
          )}
        </div>

        {isExpanded && children.map((child) => renderFolderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="folder-tree-content">
      {/* Special items */}
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
          All Entities
        </button>
        <span className="folder-tree-node__count">{totalEntityCount}</span>
      </div>

      {uncategorizedCount > 0 && (
        <div
          className={`folder-tree-node folder-tree-node--special ${selectedFolderId === '__uncategorized__' ? 'folder-tree-node--selected' : ''}`}
          style={{ paddingLeft: '12px' }}
        >
          <span className="folder-tree-node__toggle folder-tree-node__toggle--hidden">
            <ChevronRight size="xs" />
          </span>
          <button
            className="folder-tree-node__name"
            onClick={() => onSelectFolder('__uncategorized__')}
            type="button"
          >
            Uncategorized
          </button>
          <span className="folder-tree-node__count">{uncategorizedCount}</span>
        </div>
      )}

      {/* Divider */}
      {rootFolders.length > 0 && <div className="folder-tree-content__divider" />}

      {/* Folder tree */}
      {rootFolders.map((folder) => renderFolderNode(folder, 0))}

      {/* Add form */}
      {showAddForm && isMainLanguageView && (
        <div className="folder-tree-content__add-form" style={{ paddingLeft: addFormParentId ? '32px' : '12px' }}>
          <input
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') {
                setShowAddForm(false);
                setFormName('');
              }
            }}
            placeholder="Folder name"
            autoFocus
          />
          <div className="folder-tree-content__add-actions">
            <TextButton variant="ghost" size="sm" onClick={() => { setShowAddForm(false); setFormName(''); }}>
              Cancel
            </TextButton>
            <TextButton variant="secondary" size="sm" onClick={handleCreateFolder} disabled={!formName.trim()}>
              Create
            </TextButton>
          </div>
        </div>
      )}

      {/* Footer */}
      {isMainLanguageView && !showAddForm && (
        <div className="folder-tree-content__footer">
          <TextButton
            onClick={() => { setAddFormParentId(null); setFormName(''); setShowAddForm(true); }}
            iconLeft={<Plus size="xs" />}
            size="sm"
            variant="ghost"
          >
            New Folder
          </TextButton>
        </div>
      )}
    </div>
  );
};

const RenameInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}> = ({ value, onChange, onSubmit, onCancel }) => {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      className="folder-tree-node__rename-input"
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit();
        if (e.key === 'Escape') onCancel();
      }}
      onBlur={onSubmit}
    />
  );
};

export default FolderTreeContent;

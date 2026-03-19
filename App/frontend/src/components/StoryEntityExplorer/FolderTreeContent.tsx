import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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
  getStoryEntityFolderData,
  getStoryEntityFolderName,
  type StoryEntityFolder,
} from '../../types/storyEntityFolder';
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
  const isMainLanguageView = displayLanguage === mainLanguage;

  const objects = useUnifiedObjectStore((state) => state.objects);
  const createObject = useUnifiedObjectStore((state) => state.createObject);
  const updateObject = useUnifiedObjectStore((state) => state.updateObject);
  const deleteObject = useUnifiedObjectStore((state) => state.deleteObject);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addFormParentId, setAddFormParentId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
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

  const entityCountByFolder = useMemo(() => {
    return buildEntityCountByFolder(entities);
  }, [entities]);

  const folderChildren = useMemo(() => {
    return buildFolderChildrenMap(folders, displayLanguage, mainLanguage);
  }, [displayLanguage, folders, mainLanguage]);

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
      await createObject(
        'story_entity_folder',
        projectId,
        {
          name: formName.trim(),
          description: '',
        },
        mainLanguage,
        { parent_id: addFormParentId },
        'User Creation',
      );
      setFormName('');
      setShowAddForm(false);
      setAddFormParentId(null);
    } catch {
      showAlert({ title: 'Create Error', message: 'Failed to create folder.' });
    }
  }, [addFormParentId, createObject, formName, mainLanguage, projectId]);

  const handleRename = useCallback(async (folderId: string) => {
    if (!renameValue.trim()) {
      setRenamingFolderId(null);
      return;
    }
    try {
      const folder = foldersById[folderId];
      await updateObject('story_entity_folder', folderId, {
        language: mainLanguage,
        data: {
          name: renameValue.trim(),
          description: folder
            ? getStoryEntityFolderData(folder, mainLanguage, mainLanguage).description
            : '',
        },
        user_request: 'User Edit',
      });
    } catch {
      showAlert({ title: 'Rename Error', message: 'Failed to rename folder.' });
    }
    setRenamingFolderId(null);
  }, [foldersById, mainLanguage, renameValue, updateObject]);

  const handleDeleteFolder = useCallback(async (folderId: string) => {
    const confirmed = await confirm({
      title: 'Delete Folder',
      message: 'Delete this folder, its descendant folders, and all nested story entities?',
      variant: 'danger',
      confirmLabel: 'Delete',
    });
    if (!confirmed) return;
    try {
      await deleteObject('story_entity_folder', folderId);
      if (selectedFolderId === folderId) {
        onSelectFolder(null);
      }
    } catch {
      showAlert({ title: 'Delete Error', message: 'Failed to delete folder.' });
    }
  }, [deleteObject, onSelectFolder, selectedFolderId]);

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

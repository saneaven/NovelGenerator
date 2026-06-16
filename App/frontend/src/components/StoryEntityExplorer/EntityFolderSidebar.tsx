import React, { useCallback } from 'react';
import { useUiStore } from '../../store/uiStore';
import { BaseSidebar } from '../BaseSidebar';
import { IconButton } from '../IconButton';
import { Close } from '../icons';
import FolderTreeContent from './FolderTreeContent';
import './EntityFolderSidebar.css';

interface EntityFolderSidebarProps {
  projectId: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  displayLanguage: string;
}

const EntityFolderSidebar: React.FC<EntityFolderSidebarProps> = ({
  projectId,
  selectedFolderId,
  onSelectFolder,
  displayLanguage,
}) => {
  const closeSidebar = useUiStore((state) => state.closeSidebar);

  const handleClose = () => closeSidebar(projectId);

  const handleSelectFolder = useCallback((folderId: string | null) => {
    onSelectFolder(folderId);
    closeSidebar(projectId);
  }, [closeSidebar, onSelectFolder, projectId]);

  return (
    <BaseSidebar
      id="story-entity-folder"
      projectId={projectId}
      position="right"
      className="entity-folder-sidebar"
      header={
        <div className="entity-folder-sidebar__header">
          <div className="header-title-group">
            <h3 className="header-title">Folders</h3>
            <span className="header-subtitle">Organize entities</span>
          </div>
          <IconButton
            icon={<Close size="sm" />}
            onClick={handleClose}
            title="Close sidebar"
            size="sm"
            variant="ghost"
          />
        </div>
      }
      onClose={handleClose}
    >
      <div className="entity-folder-sidebar__content">
        <FolderTreeContent
          projectId={projectId}
          selectedFolderId={selectedFolderId}
          onSelectFolder={handleSelectFolder}
          displayLanguage={displayLanguage}
        />
      </div>
    </BaseSidebar>
  );
};

export default EntityFolderSidebar;

import React from 'react';
import { useSidebarStore } from '../../../store/sidebarStore';
import { BaseSidebar } from '../../../components/BaseSidebar';
import { Close, Clipboard, Folder, Document } from '../../../components/icons';
import { IconButton } from '../../../components/IconButton';
import type { StoryObjectTabType } from '../../../types/objectTypeConfig';
import { useStoryObjectTab } from '../hooks/useStoryObjectTab';
import './WorkspaceTabsSidebar.css';

interface WorkspaceTabsSidebarProps {
  projectId: string;
}

const storyObjectTabs: { id: StoryObjectTabType; label: string; icon: React.ReactNode }[] = [
  { id: 'basicInfo', label: 'Basic Info', icon: <Clipboard size="md" /> },
  { id: 'guidelines', label: 'Guidelines', icon: <Document size="md" /> },
  { id: 'storyEntities', label: 'Story Entities', icon: <Folder size="md" /> },
];

const WorkspaceTabsSidebar: React.FC<WorkspaceTabsSidebarProps> = ({
  projectId,
}) => {
  const { activeTab, setActiveTab } = useStoryObjectTab();
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);

  const handleTabSelect = (tabId: StoryObjectTabType) => {
    setActiveTab(tabId);
    closeSidebar(projectId);
  };

  const handleClose = () => {
    closeSidebar(projectId);
  };

  return (
    <BaseSidebar
      id="workspace-tabs"
      projectId={projectId}
      position="right"
      className="workspace-tabs-sidebar"
      header={
        <div className="workspace-tabs-sidebar-header">
          <h3>Story Entities</h3>
          <IconButton
            icon={<Close size="sm" />}
            onClick={handleClose}
            title="Close"
            size="sm"
            variant="ghost"
          />
        </div>
      }
      onClose={handleClose}
    >
      <div className="workspace-tabs-sidebar-content">
        {storyObjectTabs.map((tab) => (
          <button
            key={tab.id}
            className={`workspace-tab-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => handleTabSelect(tab.id)}
          >
            <span className="workspace-tab-icon">{tab.icon}</span>
            <span className="workspace-tab-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </BaseSidebar>
  );
};

export default WorkspaceTabsSidebar;

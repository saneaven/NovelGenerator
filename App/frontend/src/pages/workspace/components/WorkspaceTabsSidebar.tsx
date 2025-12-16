import React from 'react';
import { useSidebarStore } from '../../../store/sidebarStore';
import { BaseSidebar } from '../../../components/BaseSidebar';
import { Close, Clipboard, People, Organization, Map, Books, Document } from '../../../components/icons';
import { IconButton } from '../../../components/IconButton';
import './WorkspaceTabsSidebar.css';

type TabType = 'basicInfo' | 'characters' | 'organizations' | 'locations' | 'lorebook' | 'outline';

interface WorkspaceTabsSidebarProps {
  projectId: string;
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'basicInfo', label: 'Basic Info', icon: <Clipboard size="md" /> },
  { id: 'characters', label: 'Characters', icon: <People size="md" /> },
  { id: 'organizations', label: 'Organizations', icon: <Organization size="md" /> },
  { id: 'locations', label: 'Locations', icon: <Map size="md" /> },
  { id: 'lorebook', label: 'Lorebook', icon: <Books size="md" /> },
  { id: 'outline', label: 'Outline', icon: <Document size="md" /> },
];

const WorkspaceTabsSidebar: React.FC<WorkspaceTabsSidebarProps> = ({
  projectId,
  activeTab,
  onTabChange,
}) => {
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);

  const handleTabSelect = (tabId: TabType) => {
    onTabChange(tabId);
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
      width="280px"
      className="workspace-tabs-sidebar"
      header={
        <div className="workspace-tabs-sidebar-header">
          <h3>Story Objects</h3>
          <IconButton
            icon={<Close size="sm" />}
            onClick={handleClose}
            title="Close"
            size="sm"
          />
        </div>
      }
      onClose={handleClose}
    >
      <div className="workspace-tabs-sidebar-content">
        {tabs.map((tab) => (
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

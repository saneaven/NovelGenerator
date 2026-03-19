import React from 'react';
import { useSidebarStore } from '../../../store/sidebarStore';
import { BaseSidebar } from '../../../components/BaseSidebar';
import { Close, Clipboard, Document } from '../../../components/icons';
import { IconButton } from '../../../components/IconButton';
import type { ProjectHomeTab } from './ProjectHomePanel';
import './ProjectHomeSidebar.css';

interface ProjectHomeSidebarProps {
  projectId: string;
  activeTab: ProjectHomeTab;
  onTabChange: (tab: ProjectHomeTab) => void;
}

const tabs: { id: ProjectHomeTab; label: string; icon: React.ReactNode }[] = [
  { id: 'basicInfo', label: 'Basic Info', icon: <Clipboard size="md" /> },
  { id: 'guidelines', label: 'Guidelines', icon: <Document size="md" /> },
];

const ProjectHomeSidebar: React.FC<ProjectHomeSidebarProps> = ({
  projectId,
  activeTab,
  onTabChange,
}) => {
  const closeSidebar = useSidebarStore((state) => state.closeSidebar);

  const handleTabSelect = (tabId: ProjectHomeTab) => {
    onTabChange(tabId);
    closeSidebar(projectId);
  };

  const handleClose = () => {
    closeSidebar(projectId);
  };

  return (
    <BaseSidebar
      id="project-home"
      projectId={projectId}
      position="right"
      className="project-home-sidebar"
      header={
        <div className="project-home-sidebar__header">
          <h3>Project Home</h3>
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
      <div className="project-home-sidebar__content">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`project-home-sidebar__item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => handleTabSelect(tab.id)}
          >
            <span className="project-home-sidebar__item-icon">{tab.icon}</span>
            <span className="project-home-sidebar__item-label">{tab.label}</span>
          </button>
        ))}
      </div>
    </BaseSidebar>
  );
};

export default ProjectHomeSidebar;

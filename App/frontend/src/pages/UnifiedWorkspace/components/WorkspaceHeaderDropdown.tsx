import React from 'react';
import { DropdownMenu, DropdownItem } from '../../../components/ui/DropdownMenu';
import { Workspace, Clipboard, Document, ChevronDown } from '../../../components/icons';
import type { SubPageType } from '../hooks/useWorkspaceSubPage';
import './WorkspaceHeaderDropdown.css';

interface SubPageConfig {
  id: SubPageType;
  label: string;
  icon: React.ReactNode;
}

const SUB_PAGES: SubPageConfig[] = [
  { id: 'story-object', label: 'Story Objects', icon: <Workspace size="md" /> },
  { id: 'outline-manager', label: 'Outline Manager', icon: <Clipboard size="md" /> },
  { id: 'novel-editor', label: 'Novel Editor', icon: <Document size="md" /> },
];

interface WorkspaceHeaderDropdownProps {
  currentSubPage: SubPageType;
  onSubPageChange: (subPage: SubPageType) => void;
}

export const WorkspaceHeaderDropdown: React.FC<WorkspaceHeaderDropdownProps> = ({
  currentSubPage,
  onSubPageChange,
}) => {
  const currentPage = SUB_PAGES.find((p) => p.id === currentSubPage) ?? SUB_PAGES[0];

  return (
    <DropdownMenu
      trigger={
        <button className="workspace-page-selector">
          <span className="workspace-page-selector-icon">{currentPage.icon}</span>
          <span className="workspace-page-selector-label">{currentPage.label}</span>
          <ChevronDown size="sm" className="workspace-page-selector-chevron" />
        </button>
      }
      align="left"
    >
      {SUB_PAGES.map((page) => (
        <DropdownItem
          key={page.id}
          icon={page.icon}
          label={page.label}
          onClick={() => onSubPageChange(page.id)}
          className={currentSubPage === page.id ? 'active' : ''}
        />
      ))}
    </DropdownMenu>
  );
};

export default WorkspaceHeaderDropdown;

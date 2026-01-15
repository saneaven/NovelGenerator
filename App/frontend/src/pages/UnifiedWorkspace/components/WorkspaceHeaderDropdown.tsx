import React, { useState } from 'react';
import { DropdownMenu, DropdownItem, DropdownSection } from '../../../components/ui/DropdownMenu';
import { Workspace, Clipboard, Document, ChevronDown, Home } from '../../../components/icons';
import type { SubPageType } from '../hooks/useWorkspaceSubPage';
import './WorkspaceHeaderDropdown.css';

interface SubPageConfig {
  id: SubPageType;
  label: string;
  icon: React.ReactNode;
}

const SUB_PAGES: SubPageConfig[] = [
  { id: 'story-object', label: 'Story Objects', icon: <Workspace size="lg" /> },
  { id: 'outline-manager', label: 'Outline Manager', icon: <Clipboard size="lg" /> },
  { id: 'novel-editor', label: 'Novel Editor', icon: <Document size="lg" /> },
];

interface WorkspaceHeaderDropdownProps {
  currentSubPage: SubPageType;
  onSubPageChange: (subPage: SubPageType) => void;
  onHomeClick: () => void;
  align?: 'left' | 'right';
}

export const WorkspaceHeaderDropdown: React.FC<WorkspaceHeaderDropdownProps> = ({
  currentSubPage,
  onSubPageChange,
  onHomeClick,
  align = 'right',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const currentPage = SUB_PAGES.find((p) => p.id === currentSubPage) ?? SUB_PAGES[0];

  return (
    <DropdownMenu
      trigger={
        <button className={`workspace-page-selector${isOpen ? ' open' : ''}`}>
          <span className="workspace-page-selector-icon">{currentPage.icon}</span>
          <span className="workspace-page-selector-label">{currentPage.label}</span>
          <ChevronDown size="md" className={`workspace-page-selector-chevron${isOpen ? ' open' : ''}`} />
        </button>
      }
      align={align}
      onOpenChange={setIsOpen}
    >
      <DropdownSection>
        {SUB_PAGES.map((page) => (
          <DropdownItem
            key={page.id}
            icon={page.icon}
            label={page.label}
            onClick={() => onSubPageChange(page.id)}
            className={`workspace-dropdown-item${currentSubPage === page.id ? ' active' : ''}`}
          />
        ))}
      </DropdownSection>
      <DropdownSection>
        <DropdownItem
          icon={<Home size="md" />}
          label="Home"
          onClick={onHomeClick}
          className="workspace-dropdown-item"
        />
      </DropdownSection>
    </DropdownMenu>
  );
};

export default WorkspaceHeaderDropdown;

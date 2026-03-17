import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DropdownMenu, DropdownItem, DropdownSection } from '../../../components/ui/DropdownMenu';
import { Workspace, Clipboard, Document, Configs, ChevronDown, Home } from '../../../components/icons';
import type { SubPageType } from '../hooks/useWorkspaceSubPage';
import './WorkspaceHeaderDropdown.css';

interface SubPageConfig {
  id: SubPageType;
  labelKey: string;
  icon: React.ReactNode;
}

const SUB_PAGES: SubPageConfig[] = [
  { id: 'story-entity', labelKey: 'unifiedWorkspace.subPages.storyEntities', icon: <Workspace size="lg" /> },
  { id: 'outline-manager', labelKey: 'unifiedWorkspace.subPages.outlineManager', icon: <Clipboard size="lg" /> },
  { id: 'novel-editor', labelKey: 'unifiedWorkspace.subPages.novelEditor', icon: <Document size="lg" /> },
  { id: 'config', labelKey: 'unifiedWorkspace.subPages.config', icon: <Configs size="lg" /> },
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
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const currentPage = SUB_PAGES.find((p) => p.id === currentSubPage) ?? SUB_PAGES[0];

  return (
    <DropdownMenu
      trigger={
        <button className={`workspace-page-selector${isOpen ? ' open' : ''}`}>
          <span className="workspace-page-selector-icon">{currentPage.icon}</span>
          <span className="workspace-page-selector-label">{t(currentPage.labelKey)}</span>
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
            label={t(page.labelKey)}
            onClick={() => onSubPageChange(page.id)}
            className={`workspace-dropdown-item${currentSubPage === page.id ? ' active' : ''}`}
          />
        ))}
      </DropdownSection>
      <DropdownSection>
        <DropdownItem
          icon={<Home size="md" />}
          label={t('unifiedWorkspace.home')}
          onClick={onHomeClick}
          className="workspace-dropdown-item"
        />
      </DropdownSection>
    </DropdownMenu>
  );
};

export default WorkspaceHeaderDropdown;

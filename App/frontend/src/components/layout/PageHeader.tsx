import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Settings, HamburgerMenu, Save, Check, Bullet } from '../icons';
import LanguageDropdown from '../ui/LanguageDropdown';
import { ActivityPanelButton } from '../ActivityPanel';
import { IconButton } from '../IconButton';
import { WorkspaceHeaderDropdown } from '../../pages/UnifiedWorkspace';
import type { SubPageType } from '../../pages/UnifiedWorkspace';
import './PageHeader.css';

export interface PageHeaderProps {
  projectName: string;

  // Sub-page navigation
  currentSubPage: SubPageType;
  onSubPageChange: (subPage: SubPageType) => void;

  // Language
  availableLanguages: string[];
  currentLanguage: string;
  onLanguageChange: (lang: string) => void;

  // Translation
  showTranslateAll?: boolean;
  translateCount?: number;
  onTranslateAllClick?: () => void;

  // Settings (desktop only - mobile uses footer)
  onSettingsClick: () => void;

  // Mobile-specific props
  mobileSubtitle?: string;              // Subtitle (tab name or chapter name)
  showHamburger?: boolean;              // Show hamburger button
  onHamburgerClick?: () => void;        // Hamburger click handler
  showSaveIndicator?: boolean;          // Show save indicator (Novel Editor only)
  saveStatus?: 'saving' | 'unsaved' | 'saved';  // Save status
}

const PageHeader: React.FC<PageHeaderProps> = ({
  projectName,
  currentSubPage,
  onSubPageChange,
  availableLanguages,
  currentLanguage,
  onLanguageChange,
  showTranslateAll = false,
  translateCount = 0,
  onTranslateAllClick,
  onSettingsClick,
  mobileSubtitle,
  showHamburger = false,
  onHamburgerClick,
  showSaveIndicator = false,
  saveStatus = 'saved',
}) => {
  const navigate = useNavigate();

  return (
    <div className="page-header">
      {/* Desktop Header */}
      <div className="page-header-desktop">
        <div className="page-header-unified">
          <div className="page-header-unified-left">
            <IconButton
              icon={<Settings size="xl" />}
              onClick={onSettingsClick}
              title="Settings"
            />
            <ActivityPanelButton position="desktop" />
            {availableLanguages.length > 1 && (
              <LanguageDropdown
                languages={availableLanguages}
                value={currentLanguage}
                onChange={onLanguageChange}
                title="Select display language"
                showTranslateAll={showTranslateAll}
                translateCount={translateCount}
                onTranslateAllClick={onTranslateAllClick}
              />
            )}
          </div>
          <div className="page-header-unified-center">
            <Link to="/dashboard" className="page-header-project-link">{projectName}</Link>
          </div>
          <div className="page-header-controls">
            <WorkspaceHeaderDropdown
              currentSubPage={currentSubPage}
              onSubPageChange={onSubPageChange}
              onHomeClick={() => navigate('/dashboard')}
              align="right"
            />
          </div>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="page-header-mobile">
        {/* Left side */}
        <div className="page-header-mobile-left">
          <WorkspaceHeaderDropdown
            currentSubPage={currentSubPage}
            onSubPageChange={onSubPageChange}
            onHomeClick={() => navigate('/dashboard')}
            align="left"
          />

          {showSaveIndicator && (
            <div className={`page-header-save-indicator ${saveStatus}`}>
              {saveStatus === 'saving' && <Save size="sm" />}
              {saveStatus === 'unsaved' && <Bullet size="sm" />}
              {saveStatus === 'saved' && <Check size="sm" />}
            </div>
          )}
        </div>

        {/* Center - absolutely positioned */}
        <div className="page-header-mobile-center">
          {mobileSubtitle && (
            <span className="page-header-mobile-subtitle">{mobileSubtitle}</span>
          )}
        </div>

        {/* Right side */}
        <div className="page-header-mobile-right">
          {availableLanguages.length > 1 && (
            <LanguageDropdown
              languages={availableLanguages}
              value={currentLanguage}
              onChange={onLanguageChange}
              title="Select display language"
              showTranslateAll={showTranslateAll}
              translateCount={translateCount}
              onTranslateAllClick={onTranslateAllClick}
            />
          )}

          {showHamburger && (
            <IconButton
              icon={<HamburgerMenu size="md" />}
              onClick={onHamburgerClick}
              title="Menu"
              size="sm"
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default PageHeader;

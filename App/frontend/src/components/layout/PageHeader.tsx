import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings, HamburgerMenu, Save, Check, Bullet } from '../icons';
import LanguageDropdown from '../ui/LanguageDropdown';
import { NotificationButton } from '../Notification';
import { IconButton } from '../IconButton';
import { WorkspaceHeaderDropdown } from '../../pages/UnifiedWorkspace';
import type { SubPageType } from '../../pages/UnifiedWorkspace';
import './PageHeader.css';

export interface PageHeaderProps {
  projectId: string;
  projectName: string;
  pageTitle?: string;           // "Workspace" or "Novel Editor" (optional when using dropdown)

  // Sub-page navigation (unified workspace mode)
  currentSubPage?: SubPageType;
  onSubPageChange?: (subPage: SubPageType) => void;

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
  projectId,
  projectName,
  pageTitle,
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

  // Unified workspace mode uses dropdown navigation
  const isUnifiedWorkspace = currentSubPage !== undefined && onSubPageChange !== undefined;

  return (
    <div className="page-header">
      {/* Desktop Header */}
      <div className="page-header-desktop">
        {isUnifiedWorkspace ? (
          // Unified workspace: Dropdown left, Project name center, Controls right
          <div className="page-header-unified">
            <div className="page-header-unified-left">
              <IconButton
                icon={<ArrowLeft size="lg" />}
                onClick={() => navigate('/')}
                title="Back to home"
              />
              <WorkspaceHeaderDropdown
                currentSubPage={currentSubPage}
                onSubPageChange={onSubPageChange}
              />
            </div>
            <div className="page-header-unified-center">
              <Link to="/" className="page-header-project-link">{projectName}</Link>
            </div>
            <div className="page-header-controls">
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
              <NotificationButton position="desktop" />
              <IconButton
                icon={<Settings size="xl" />}
                onClick={onSettingsClick}
                title="Settings"
              />
            </div>
          </div>
        ) : (
          // Legacy mode: Breadcrumb navigation
          <>
            <div className="breadcrumb">
              <Link to="/" className="breadcrumb-link">Home</Link>
              <span className="breadcrumb-separator"> / </span>
              <Link to={`/project/${projectId}`} className="breadcrumb-link">{projectName}</Link>
              <span className="breadcrumb-separator"> / </span>
              <span className="breadcrumb-current">{pageTitle}</span>
            </div>
            <div className="page-header-title-row">
              <h1 className="page-header-title">{pageTitle}</h1>
              <div className="page-header-controls">
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
                <NotificationButton position="desktop" />
                <IconButton
                  icon={<Settings size="xl" />}
                  onClick={onSettingsClick}
                  title="Settings"
                />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Mobile Header */}
      <div className="page-header-mobile">
        {/* Left side */}
        <div className="page-header-mobile-left">
          <IconButton
            icon={<ArrowLeft size="md" />}
            onClick={() => navigate('/')}
            title="Back to home"
            size="sm"
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
          {isUnifiedWorkspace ? (
            <WorkspaceHeaderDropdown
              currentSubPage={currentSubPage}
              onSubPageChange={onSubPageChange}
            />
          ) : (
            <>
              <h1 className="page-header-mobile-title">{pageTitle}</h1>
              {mobileSubtitle && (
                <span className="page-header-mobile-subtitle">{mobileSubtitle}</span>
              )}
            </>
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

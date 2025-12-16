import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings, HamburgerMenu, Save, Check, Bullet } from '../icons';
import LanguageDropdown from '../ui/LanguageDropdown';
import { NotificationButton } from '../Notification';
import { IconButton } from '../IconButton';
import './PageHeader.css';

export interface PageHeaderProps {
  projectId: string;
  projectName: string;
  pageTitle: string;           // "Workspace" or "Novel Editor"

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
      </div>

      {/* Mobile Header */}
      <div className="page-header-mobile">
        {/* Left side */}
        <div className="page-header-mobile-left">
          <IconButton
            icon={<ArrowLeft size="md" />}
            onClick={() => navigate(`/project/${projectId}`)}
            title="Back to project"
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
          <h1 className="page-header-mobile-title">{pageTitle}</h1>
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

import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings } from '../icons';
import LanguageDropdown from '../ui/LanguageDropdown';
import { NotificationButton } from '../Notification';
import '../Notification/Notification.css';
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
            <button
              className="settings-btn"
              onClick={onSettingsClick}
              title="Settings"
            >
              <Settings size="xl" />
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Header */}
      <div className="page-header-mobile">
        <button
          className="page-header-back-btn"
          onClick={() => navigate(`/project/${projectId}`)}
          title="Back to project"
        >
          <ArrowLeft size="md" />
        </button>
        <h1 className="page-header-mobile-title">{pageTitle}</h1>
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
    </div>
  );
};

export default PageHeader;

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../IconButton';
import { ChevronLeft, ChevronRight, Copy, Edit } from '../../icons';
import './EditorPanelHeader.css';

interface EditorPanelHeaderProps {
  title: string;
  editableTitle?: boolean;
  titleStaticPrefix?: string;
  onTitleChange?: (value: string) => void;
  titlePlaceholder?: string;
  editTitleLabel?: string;
  badge?: React.ReactNode;
  subtitle?: string;
  editableSubtitle?: boolean;
  onSubtitleChange?: (value: string) => void;
  subtitlePlaceholder?: string;
  onCopyTitle?: () => void;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

const EditorPanelHeader: React.FC<EditorPanelHeaderProps> = ({
  title,
  editableTitle,
  titleStaticPrefix,
  onTitleChange,
  titlePlaceholder,
  editTitleLabel,
  badge,
  subtitle,
  editableSubtitle,
  onSubtitleChange,
  subtitlePlaceholder,
  onCopyTitle,
  meta,
  actions,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const { t } = useTranslation();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState('');

  useEffect(() => {
    setIsEditingTitle(false);
    setIsEditing(false);
  }, [title, titleStaticPrefix]);

  const handleStartTitleEdit = useCallback(() => {
    setEditedTitle(title || '');
    setIsEditingTitle(true);
  }, [title]);

  const handleSaveTitle = useCallback(() => {
    const trimmed = editedTitle.trim();
    if (trimmed && trimmed !== title) {
      onTitleChange?.(trimmed);
    }
    setIsEditingTitle(false);
  }, [editedTitle, onTitleChange, title]);

  const handleCancelTitle = useCallback(() => {
    setIsEditingTitle(false);
  }, []);

  const renderTitle = () => {
    if (!editableTitle) {
      return <h3 className="editor-panel-header__title">{title}</h3>;
    }

    if (isEditingTitle) {
      return (
        <div className="editor-panel-header__title editor-panel-header__title--editable">
          {titleStaticPrefix && (
            <span className="editor-panel-header__title-prefix">{titleStaticPrefix}</span>
          )}
          <input
            type="text"
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            onBlur={handleSaveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveTitle();
              if (e.key === 'Escape') handleCancelTitle();
            }}
            placeholder={titlePlaceholder}
            className="editor-panel-header__title-input"
            autoFocus
          />
        </div>
      );
    }

    return (
      <>
        <h3 className="editor-panel-header__title editor-panel-header__title--editable">
          {titleStaticPrefix && (
            <span className="editor-panel-header__title-prefix">{titleStaticPrefix}</span>
          )}
          <span className="editor-panel-header__title-text">
            {title || titlePlaceholder || ''}
          </span>
        </h3>
        <button
          className="editor-panel-header__title-edit"
          onClick={handleStartTitleEdit}
          title={editTitleLabel || t('common.edit')}
          type="button"
        >
          <Edit size="xs" />
        </button>
      </>
    );
  };

  const handleStartEdit = useCallback(() => {
    setEditedValue(subtitle || '');
    setIsEditing(true);
  }, [subtitle]);

  const handleSave = useCallback(() => {
    const trimmed = editedValue.trim();
    if (trimmed !== (subtitle || '')) {
      onSubtitleChange?.(trimmed);
    }
    setIsEditing(false);
  }, [editedValue, subtitle, onSubtitleChange]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
  }, []);

  const renderSubtitle = () => {
    if (editableSubtitle) {
      if (isEditing) {
        return (
          <div className="editor-panel-header__subtitle editor-panel-header__subtitle--editable">
            <input
              type="text"
              value={editedValue}
              onChange={(e) => setEditedValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') handleCancel();
              }}
              placeholder={subtitlePlaceholder}
              className="editor-panel-header__subtitle-input"
              autoFocus
            />
          </div>
        );
      }

      return (
        <div className="editor-panel-header__subtitle editor-panel-header__subtitle--editable">
          <span className="editor-panel-header__subtitle-text">
            {subtitle || subtitlePlaceholder || ''}
          </span>
          <button
            className="editor-panel-header__subtitle-edit"
            onClick={handleStartEdit}
            title={t('settings.promptEditor.editDescription')}
          >
            <Edit size="xs" />
          </button>
        </div>
      );
    }

    if (subtitle) {
      return <p className="editor-panel-header__subtitle">{subtitle}</p>;
    }

    return null;
  };

  return (
    <header className="editor-panel-header">
      <div className="editor-panel-header__left">
        <div className="editor-panel-header__title-row">
          {renderTitle()}
          {badge}
          {onCopyTitle && (
            <IconButton
              icon={<Copy size="sm" />}
              onClick={onCopyTitle}
              title={t('common.copy')}
              size="xs"
            />
          )}
        </div>
        {renderSubtitle()}
        {meta && <div className="editor-panel-header__meta">{meta}</div>}
      </div>

      {onToggleSidebar && (
        <div className="editor-panel-header__right">
          {actions && (
            <>
              <div className="editor-panel-header__actions">{actions}</div>
              <span className="editor-panel-header__divider" />
            </>
          )}
          <IconButton
            icon={isSidebarCollapsed ? <ChevronLeft size="lg" /> : <ChevronRight size="lg" />}
            onClick={onToggleSidebar}
            title={
              isSidebarCollapsed
                ? t('settings.promptEditor.expandSidebar')
                : t('settings.promptEditor.collapseSidebar')
            }
            size="lg"
            variant="ghost"
          />
        </div>
      )}
    </header>
  );
};

export default EditorPanelHeader;

import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../IconButton';
import { ChevronLeft, ChevronRight, Copy, Edit } from '../../icons';
import './EditorPanelHeader.css';

interface EditorPanelHeaderProps {
  title: string;
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

  const [isEditing, setIsEditing] = useState(false);
  const [editedValue, setEditedValue] = useState('');

  useEffect(() => {
    setIsEditing(false);
  }, [title]);

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
          <h3 className="editor-panel-header__title">{title}</h3>
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

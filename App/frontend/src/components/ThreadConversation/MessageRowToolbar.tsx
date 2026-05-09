import React from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../IconButton';
import { Edit, Eye, Globe, Trash } from '../icons';

interface MessageRowToolbarProps {
  canEdit: boolean;
  canTranslate: boolean;
  canToggleLanguage: boolean;
  canDelete: boolean;
  editDisabled?: boolean;
  translateDisabled?: boolean;
  deleteDisabled?: boolean;
  languageToggleActive?: boolean;
  isTranslating?: boolean;
  translationAvailable?: boolean;
  sourceLanguage?: string;
  targetLanguage?: string;
  onEdit: () => void;
  onTranslate: () => void;
  onToggleLanguage: () => void;
  onDelete: () => void;
}

const MessageRowToolbar: React.FC<MessageRowToolbarProps> = React.memo(({
  canEdit,
  canTranslate,
  canToggleLanguage,
  canDelete,
  editDisabled = false,
  translateDisabled = false,
  deleteDisabled = false,
  languageToggleActive = false,
  isTranslating = false,
  translationAvailable = false,
  sourceLanguage,
  targetLanguage,
  onEdit,
  onTranslate,
  onToggleLanguage,
  onDelete,
}) => {
  const { t } = useTranslation();

  if (!canEdit && !canTranslate && !canToggleLanguage && !canDelete) return null;

  const translateTitle = targetLanguage
    ? (
        translationAvailable
          ? t('agent.refreshTranslation', { language: targetLanguage })
          : t('agent.translateTo', { language: targetLanguage })
      )
    : t('agent.translateTo', { language: '' });
  const languageToggleTitle = languageToggleActive
    ? t('agent.switchToLanguage', { language: sourceLanguage ?? '' })
    : t('agent.switchToLanguage', { language: targetLanguage ?? '' });

  return (
    <div className="thread-message-toolbar" aria-label={t('agent.messageActions')}>
      {canEdit && (
        <IconButton
          icon={<Edit size="sm" />}
          onClick={onEdit}
          disabled={editDisabled}
          title={t('agent.edit')}
          variant="ghost"
          size="sm"
        />
      )}
      {canToggleLanguage && (
        <IconButton
          icon={<Eye size="sm" />}
          onClick={onToggleLanguage}
          title={languageToggleTitle}
          variant="ghost"
          size="sm"
          isActive={languageToggleActive}
        />
      )}
      {canTranslate && (
        <IconButton
          icon={<Globe size="sm" />}
          onClick={onTranslate}
          title={translateTitle}
          variant="ghost"
          size="sm"
          disabled={translateDisabled || isTranslating}
          showSpinner={isTranslating}
        />
      )}
      {canDelete && (
        <IconButton
          icon={<Trash size="sm" />}
          onClick={onDelete}
          title={t('agent.delete')}
          variant="ghost"
          size="sm"
          disabled={deleteDisabled}
          className="icon-button--ghost-danger"
        />
      )}
    </div>
  );
});

export default MessageRowToolbar;

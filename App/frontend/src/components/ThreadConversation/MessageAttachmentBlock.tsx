import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ThreadMessage } from '../../types/thread';
import AuthenticatedImage from '../common/AuthenticatedImage';
import { Document, Text } from '../icons';
import { formatAttachmentSize } from '../../utils/threadAttachments';

interface MessageAttachmentBlockProps {
  attachments: ThreadMessage['attachments'];
}

const MessageAttachmentBlock: React.FC<MessageAttachmentBlockProps> = React.memo(({
  attachments,
}) => {
  const { t } = useTranslation();
  const sortedAttachments = [...attachments].sort((a, b) => a.sortOrder - b.sortOrder);
  const imageAttachments = sortedAttachments.filter((attachment) => attachment.kind === 'image');
  const documentAttachments = sortedAttachments.filter((attachment) => attachment.kind === 'document');
  const textFileAttachments = sortedAttachments.filter((attachment) => attachment.kind === 'text_file');

  if (sortedAttachments.length === 0) return null;

  const renderFileAttachment = (
    attachment: ThreadMessage['attachments'][number],
    icon: React.ReactNode,
  ) => (
    <div key={attachment.id} className="thread-message-attachment-file">
      <div className="thread-message-attachment-file__icon" aria-hidden="true">
        {icon}
      </div>
      <div className="thread-message-attachment-file__meta">
        <div
          className="thread-message-attachment-file__name"
          title={attachment.originalFilename}
        >
          {attachment.originalFilename}
        </div>
        <div className="thread-message-attachment-file__size">
          {formatAttachmentSize(attachment.fileSize)}
        </div>
      </div>
      {attachment.url ? (
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="thread-message-attachment-file__link"
        >
          {t('agent.viewAttachment')}
        </a>
      ) : null}
    </div>
  );

  return (
    <div className="thread-message-attachments">
      {imageAttachments.length > 0 && (
        <div className={`thread-message-attachments__image-grid${imageAttachments.length === 1 ? ' thread-message-attachments__image-grid--single' : ''}`}>
          {imageAttachments.map((attachment) => (
            <div key={attachment.id} className="thread-message-attachment-image">
              <AuthenticatedImage
                src={attachment.url}
                alt={attachment.originalFilename}
                className="thread-message-attachment-image__asset"
              />
            </div>
          ))}
        </div>
      )}

      {documentAttachments.length > 0 && (
        <div className="thread-message-attachments__files">
          {documentAttachments.map((attachment) => renderFileAttachment(
            attachment,
            <Document size="md" />,
          ))}
        </div>
      )}

      {textFileAttachments.length > 0 && (
        <div className="thread-message-attachments__files">
          {textFileAttachments.map((attachment) => renderFileAttachment(
            attachment,
            <Text size="md" />,
          ))}
        </div>
      )}
    </div>
  );
});

export default MessageAttachmentBlock;

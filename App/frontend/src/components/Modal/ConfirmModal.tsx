import React from 'react';
import { BaseModal } from '../BaseModal';
import { TextButton } from '../TextButton';
import { Warning, Info } from '../icons';
import { useDialogStore } from '../../store/dialogStore';
import type { DialogVariant } from '../../store/dialogStore';
import './ConfirmModal.css';

const VARIANT_CONFIG: Record<DialogVariant, {
  icon: React.ReactNode;
  confirmButtonVariant: 'primary' | 'danger' | 'warning';
}> = {
  danger: { icon: <Warning size="xl" />, confirmButtonVariant: 'danger' },
  warning: { icon: <Warning size="xl" />, confirmButtonVariant: 'warning' },
  info: { icon: <Info size="xl" />, confirmButtonVariant: 'primary' },
};

const ConfirmModal: React.FC = () => {
  const queue = useDialogStore((state) => state.queue);
  const respond = useDialogStore((state) => state.respond);

  const entry = queue[0];
  if (!entry) return null;

  const config = VARIANT_CONFIG[entry.variant];
  const isAlert = entry.type === 'alert';

  return (
    <BaseModal
      isOpen={true}
      onClose={() => respond(false)}
      size="small"
      closeOnOverlayClick={isAlert}
      closeOnEscape={true}
      zIndexLayer={3}
      title={
        <>
          <span className={`confirm-dialog-icon confirm-dialog-icon--${entry.variant}`}>
            {config.icon}
          </span>
          {entry.title}
        </>
      }
      className={`confirm-dialog confirm-dialog--${entry.variant}`}
      footer={
        <>
          {!isAlert && (
            <TextButton variant="secondary" onClick={() => respond(false)}>
              {entry.cancelLabel}
            </TextButton>
          )}
          <TextButton
            variant={config.confirmButtonVariant}
            onClick={() => respond(true)}
          >
            {entry.confirmLabel}
          </TextButton>
        </>
      }
    >
      <p className="confirm-dialog-message">{entry.message}</p>
      {entry.detail && (
        <details className="confirm-dialog-detail">
          <summary>Show Detail</summary>
          <pre className="confirm-dialog-detail-content">{entry.detail}</pre>
        </details>
      )}
    </BaseModal>
  );
};

export default ConfirmModal;

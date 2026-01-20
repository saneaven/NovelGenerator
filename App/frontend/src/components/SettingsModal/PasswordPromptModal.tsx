import React, { useEffect, useState } from 'react';
import { BaseModal } from '../BaseModal';
import { TextButton } from '../TextButton';
import './PasswordPromptModal.css';

interface PasswordPromptModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  isLoading?: boolean;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}

const PasswordPromptModal: React.FC<PasswordPromptModalProps> = ({
  isOpen,
  title,
  description,
  confirmLabel,
  isLoading = false,
  onConfirm,
  onClose,
}) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setError(null);
    }
  }, [isOpen]);

  const handleConfirm = async () => {
    setError(null);
    try {
      await onConfirm(password);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      size="small"
      title={title}
      zIndexLayer={1}
      footer={
        <>
          <TextButton variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </TextButton>
          <TextButton
            variant="primary"
            onClick={handleConfirm}
            disabled={isLoading || !password}
            loading={isLoading}
          >
            {confirmLabel}
          </TextButton>
        </>
      }
    >
      <div className="password-prompt-modal">
        {description && <p className="password-prompt-description">{description}</p>}
        <div className="form-field">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            disabled={isLoading}
          />
        </div>
        {error && <div className="form-error">{error}</div>}
      </div>
    </BaseModal>
  );
};

export default PasswordPromptModal;


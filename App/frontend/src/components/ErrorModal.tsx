import React from 'react';
import './ErrorModal.css';

interface ErrorModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onClose: () => void;
}

const ErrorModal: React.FC<ErrorModalProps> = ({ isOpen, title, message, onClose }) => {
  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div 
      className="error-modal-overlay" 
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="error-modal">
        <div className="error-modal-header">
          <div className="error-icon">⚠️</div>
          <h3 className="error-title">{title}</h3>
          <button 
            className="error-close-btn"
            onClick={onClose}
            title="Close"
          >
            ✕
          </button>
        </div>
        
        <div className="error-modal-body">
          <p className="error-message">{message}</p>
        </div>
        
        <div className="error-modal-footer">
          <button 
            className="error-ok-btn"
            onClick={onClose}
            autoFocus
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
};

export default ErrorModal;
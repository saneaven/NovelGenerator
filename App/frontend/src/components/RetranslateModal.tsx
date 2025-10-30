import React, { useState } from 'react';

interface RetranslateModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceLanguage: string;
  targetLanguage: string;
  translationTimestamp: string | null;
  onRetranslate: (includePrevious: boolean, userInstructions: string) => void;
  isTranslating: boolean;
}

const RetranslateModal: React.FC<RetranslateModalProps> = ({
  isOpen,
  onClose,
  sourceLanguage,
  targetLanguage,
  translationTimestamp,
  onRetranslate,
  isTranslating,
}) => {
  const [includePrevious, setIncludePrevious] = useState(true);
  const [userInstructions, setUserInstructions] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onRetranslate(includePrevious, userInstructions.trim());
  };

  const handleCancel = () => {
    if (!isTranslating) {
      setUserInstructions('');
      setIncludePrevious(true);
      onClose();
    }
  };

  const formatTimestamp = (timestamp: string | null): string => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content retranslate-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🔄 Retranslate Chapter to {targetLanguage}</h2>
          <button className="modal-close" onClick={handleCancel} disabled={isTranslating}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="retranslate-form">
          <div className="info-section">
            <h3>📋 Previous Translation Info</h3>
            <div className="info-content">
              <div className="info-row">
                <span className="info-label">Source:</span>
                <span className="info-value">{sourceLanguage} → {targetLanguage}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Date:</span>
                <span className="info-value">{formatTimestamp(translationTimestamp)}</span>
              </div>
            </div>
          </div>

          <div className="form-group">
            <h3>⚙️ Retranslation Options</h3>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={includePrevious}
                onChange={(e) => setIncludePrevious(e.target.checked)}
                disabled={isTranslating}
              />
              <span className="checkbox-text">
                Include previous translation as reference
              </span>
            </label>
            <p className="field-hint">
              💡 Shows the AI your previous translation to maintain consistency in style, tone, and terminology
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="user-instructions">✏️ Additional Instructions (Optional)</label>
            <textarea
              id="user-instructions"
              value={userInstructions}
              onChange={(e) => setUserInstructions(e.target.value)}
              placeholder="e.g., Make it more formal, Fix grammar issues, Use simpler vocabulary, Improve readability"
              rows={4}
              disabled={isTranslating}
              className="instructions-textarea"
            />
          </div>

          {isTranslating && (
            <div className="processing-message">
              <span className="spinner">⏳</span>
              <span>Retranslating...</span>
            </div>
          )}

          <div className="modal-actions">
            <button
              type="button"
              onClick={handleCancel}
              disabled={isTranslating}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isTranslating}
              className="btn-primary"
            >
              {isTranslating ? 'Retranslating...' : 'Retranslate'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RetranslateModal;
